import {
  useEffect,
  useRef,
  useState,
  type UIEvent as ReactUIEvent,
  type ReactNode,
} from "react";
import { Button, Empty, Input, Modal, Select, Space, Spin, Tag, Typography } from "antd";
import { fontSizeRem } from "../../../shared/appearance";
import { useBrowserNavStore } from "@renderer/stores/browser-nav";
import { useLayoutStore } from "@renderer/stores/layout";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useDialog, useMessage, type DialogHandle } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import { PI_MARKET_URL, PI_PACKAGES_DOCS_URL } from "../../../shared/pi-cli";
import {
  piInstallCommand,
  type PiPackageListItem,
  type PiPackageType,
} from "../../../shared/pi-market";
import styles from "./MarketSettings.module.css";

type InstalledPkg = {
  source: string;
  scope: "global" | "project";
};

type Props = {
  open: boolean;
  onClose?: () => void;
};

type TypeOption = { label: string; value: PiPackageType };

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function MarketSettings({ open, onClose }: Props): ReactNode {
  const t = useI18n();
  const message = useMessage();
  const dialog = useDialog();
  const browserNav = useBrowserNavStore();
  const layout = useLayoutStore();
  const rightTabs = useRightTabsStore();
  const workspace = useWorkspaceStore();

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pkgType, setPkgType] = useState<PiPackageType>("");
  const [items, setItems] = useState<PiPackageListItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalHint, setTotalHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bare package name → installed entries (npm:foo → foo). */
  const [installedByName, setInstalledByName] = useState<Map<string, InstalledPkg[]>>(new Map());
  const listElRef = useRef<HTMLDivElement | null>(null);
  const loadSeqRef = useRef(0);
  const prevPkgTypeRef = useRef(pkgType);
  const prevQueryRef = useRef(query);

  const typeOptions: TypeOption[] = [
    { label: t.marketTypeAll, value: "" },
    { label: t.marketTypeExtension, value: "extension" },
    { label: t.marketTypeSkill, value: "skill" },
    { label: t.marketTypeTheme, value: "theme" },
    { label: t.marketTypePrompt, value: "prompt" },
  ];

  const filteredEmpty = !loading && !error && items.length === 0;

  function barePackageName(source: string): string {
    return source.replace(/^npm:/i, "").trim();
  }

  function installedEntries(pkgName: string): InstalledPkg[] {
    return installedByName.get(pkgName) ?? [];
  }

  function isInstalled(pkgName: string): boolean {
    return installedEntries(pkgName).length > 0;
  }

  async function loadInstalled(): Promise<void> {
    try {
      const data = await window.api.plugins.list(workspace.root ?? undefined);
      const map = new Map<string, InstalledPkg[]>();
      for (const pkg of data.packages) {
        const name = barePackageName(pkg.source);
        if (!name) continue;
        const list = map.get(name) ?? [];
        list.push({ source: pkg.source, scope: pkg.scope });
        map.set(name, list);
      }
      setInstalledByName(map);
    } catch {
      // Market still usable without local install status
      setInstalledByName(new Map());
    }
  }

  function mergeItems(
    prev: PiPackageListItem[],
    next: PiPackageListItem[],
  ): PiPackageListItem[] {
    const seen = new Set(prev.map((p) => p.name));
    const out = [...prev];
    for (const item of next) {
      if (seen.has(item.name)) continue;
      seen.add(item.name);
      out.push(item);
    }
    return out;
  }

  async function fetchPage(nextPage: number, append: boolean): Promise<void> {
    const seq = ++loadSeqRef.current;
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError(null);
    }
    try {
      const listPromise = window.api.market.list({
        query: query.trim() || undefined,
        type: pkgType || undefined,
        page: nextPage,
      });
      const tasks: Promise<unknown>[] = [listPromise];
      if (!append) tasks.push(loadInstalled());
      await Promise.all(tasks);
      const result = await listPromise;
      if (seq !== loadSeqRef.current) return;
      if (!result.ok) {
        if (!append) {
          setError(result.error ?? t.marketLoadFailed);
          setItems([]);
          setTotalHint(null);
          setHasMore(false);
          setPage(1);
        } else {
          message.error(result.error ?? t.marketLoadFailed);
        }
        return;
      }
      setItems((current) => (append ? mergeItems(current, result.items) : result.items));
      setPage(result.page);
      setHasMore(result.hasMore);
      setTotalHint(result.totalHint);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (!append) {
        setError(msg);
        setItems([]);
        setHasMore(false);
      } else {
        message.error(msg);
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  async function refresh(): Promise<void> {
    setPage(1);
    setHasMore(false);
    await fetchPage(1, false);
    await nextFrame();
    if (listElRef.current) listElRef.current.scrollTop = 0;
  }

  async function loadMore(): Promise<void> {
    if (loading || loadingMore || !hasMore) return;
    await fetchPage(page + 1, true);
  }

  function onListScroll(event: ReactUIEvent<HTMLDivElement>): void {
    const el = event.currentTarget;
    if (loading || loadingMore || !hasMore) return;
    const remain = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remain < 120) void loadMore();
  }

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  useEffect(() => {
    if (prevPkgTypeRef.current === pkgType) return;
    prevPkgTypeRef.current = pkgType;
    void refresh();
  }, [pkgType]);

  useEffect(() => {
    if (prevQueryRef.current === query) return;
    prevQueryRef.current = query;
    const timer = window.setTimeout(() => {
      void refresh();
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  function openInBuiltinBrowser(url: string): void {
    // Always open a new browser tab — never overwrite an existing one.
    const tab = rightTabs.addTab("browser");
    browserNav.requestNavigate(url, tab.id);
    if (layout.rightCollapsed) layout.toggleRightCollapsed();
    onClose?.();
  }

  async function openExternal(url: string): Promise<void> {
    await window.api.browser.openExternal(url);
  }

  async function installPkg(pkg: PiPackageListItem): Promise<void> {
    if (busy) return;
    setBusy(pkg.name);
    try {
      const result = await window.api.market.install(pkg.name);
      if (result.ok) {
        message.success(t.marketInstalled(pkg.name));
        await loadInstalled();
      } else {
        message.error(result.error || t.marketInstallFailed);
        if (result.log?.trim()) {
          console.warn("[market install]", result.command, result.log);
        }
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function uninstallPkg(pkg: PiPackageListItem): void {
    const entries = installedEntries(pkg.name);
    if (!entries.length || busy) return;

    let d: DialogHandle;
    d = dialog.warning({
      title: t.marketUninstall,
      content: t.marketUninstallConfirm(pkg.name),
      positiveText: t.uninstall,
      negativeText: t.cancel,
      onPositiveClick: () => {
        d.loading = true;
        setBusy(pkg.name);
        return (async () => {
          try {
            for (const entry of entries) {
              await window.api.plugins.remove(entry.source, entry.scope, workspace.root ?? undefined);
            }
            message.success(t.marketUninstalled(pkg.name));
            await loadInstalled();
            return true;
          } catch (err) {
            message.error(err instanceof Error ? err.message : t.marketUninstallFailed);
            d.loading = false;
            return false;
          } finally {
            setBusy(null);
          }
        })();
      },
    });
  }

  async function copyCmd(pkg: PiPackageListItem): Promise<void> {
    await navigator.clipboard.writeText(piInstallCommand(pkg.name));
    message.success(t.marketInstallCopied);
  }

  return (
    <Modal
      open={open}
      className="pi-settings-modal"
      width="min(880px, 96vw)"
      title={t.marketTitle}
      onCancel={() => onClose?.()}
      footer={
        <Space style={{ justifyContent: "flex-end" }}>
          <Button className="pi-interactive" onClick={() => onClose?.()}>
            {t.close}
          </Button>
        </Space>
      }
    >
      <div className="modal-scroll">
        <Typography.Text
          type="secondary"
          style={{ fontSize: fontSizeRem(13), lineHeight: 1.55, display: "block", marginBottom: 12 }}
        >
          {t.marketHint}
        </Typography.Text>

        <div className={styles.toolbar}>
          <Input
            value={query}
            size="small"
            allowClear
            placeholder={t.marketSearchPlaceholder}
            className={styles.search}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select
            value={pkgType}
            size="small"
            options={typeOptions}
            className={styles.type}
            onChange={(value) => setPkgType(value)}
          />
          <Button
            size="small"
            className="pi-interactive"
            loading={loading}
            onClick={() => void refresh()}
          >
            {t.filesRefresh}
          </Button>
        </div>

        <div className={styles.metaRow}>
          <Typography.Text type="secondary" style={{ fontSize: fontSizeRem(11) }}>
            {totalHint ? t.marketShowing(totalHint) : t.marketFromPiDev}
          </Typography.Text>
          <Space size={6}>
            <Button
              type="text"
              size="small"
              className="pi-interactive"
              onClick={() => openInBuiltinBrowser(PI_MARKET_URL)}
            >
              {t.marketOpenBuiltin}
            </Button>
            <Button
              type="text"
              size="small"
              className="pi-interactive"
              onClick={() => void openExternal(PI_PACKAGES_DOCS_URL)}
            >
              {t.marketDocs}
            </Button>
          </Space>
        </div>

        <div className={styles.listWrap}>
          <div ref={listElRef} className={styles.listSpin} onScroll={onListScroll}>
            <Spin spinning={loading}>
              {error ? (
                <Empty description={error} className={styles.empty} />
              ) : filteredEmpty ? (
                <Empty description={t.marketEmpty} className={styles.empty} />
              ) : (
                <ul className={styles.pkgList}>
                  {items.map((pkg) => (
                    <li key={pkg.name} className={styles.pkgRow}>
                      <div className={styles.pkgMain}>
                        <div className={styles.pkgTitleRow}>
                          <button
                            type="button"
                            className={`${styles.pkgName} pi-interactive`}
                            title={pkg.path}
                            onClick={() => openInBuiltinBrowser(`${PI_MARKET_URL}/${pkg.name}`)}
                          >
                            {pkg.name}
                          </button>
                          {isInstalled(pkg.name) ? (
                            <Tag color="success" variant="filled" className={styles.tag}>
                              {t.marketAlreadyInstalled}
                            </Tag>
                          ) : null}
                        </div>
                        <div className={styles.pkgDesc}>{pkg.description || "—"}</div>
                        <code className={styles.pkgCmd}>{piInstallCommand(pkg.name)}</code>
                      </div>
                      <div className={styles.pkgActions}>
                        <Button
                          size="small"
                          type="default"
                          className="pi-interactive"
                          disabled={Boolean(busy)}
                          onClick={() => void copyCmd(pkg)}
                        >
                          {t.copy}
                        </Button>
                        {isInstalled(pkg.name) ? (
                          <Button
                            size="small"
                            danger
                            type="default"
                            className="pi-interactive"
                            loading={busy === pkg.name}
                            disabled={Boolean(busy) && busy !== pkg.name}
                            onClick={() => uninstallPkg(pkg)}
                          >
                            {t.marketUninstall}
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            type="primary"
                            className="pi-interactive"
                            loading={busy === pkg.name}
                            disabled={Boolean(busy) && busy !== pkg.name}
                            onClick={() => void installPkg(pkg)}
                          >
                            {t.marketInstall}
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                  {items.length && (hasMore || loadingMore) ? (
                    <li className={styles.pkgFooter}>
                      {hasMore && !loadingMore ? (
                        <Button
                          size="small"
                          type="text"
                          className="pi-interactive"
                          onClick={() => void loadMore()}
                        >
                          {t.marketLoadMore}
                        </Button>
                      ) : loadingMore ? (
                        <div className={styles.loadMoreInline}>
                          <Spin size="small" />
                          <span>{t.marketLoadingMore}</span>
                        </div>
                      ) : null}
                    </li>
                  ) : items.length && !hasMore && !loading && !loadingMore ? (
                    <li className={styles.pkgFooter}>
                      <Typography.Text type="secondary" style={{ fontSize: fontSizeRem(11) }}>
                        {t.marketEnd}
                      </Typography.Text>
                    </li>
                  ) : null}
                </ul>
              )}
            </Spin>
          </div>
          {loadingMore ? (
            <div className={styles.loadMoreBar} aria-live="polite">
              <Spin size="small" />
              <span>{t.marketLoadingMore}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

export default MarketSettings;
