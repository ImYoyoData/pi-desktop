import { useMemo, useState, type ReactNode } from "react";
import { Button, Empty, Input } from "antd";
import {
  ChevronDownOutline,
  ChevronForwardOutline,
  EarthOutline,
  SearchOutline,
  TrashOutline,
} from "@renderer/components/icons/ionicons";
import {
  filterEntries,
  groupHistoryByRecency,
  type BookmarkEntry,
  type BrowserLibraryEntry,
  type HistoryGroupKey,
} from "@renderer/stores/browser-library";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./BrowserLibraryPanel.module.css";

type Props = {
  mode: "history" | "bookmarks";
  history: BrowserLibraryEntry[];
  bookmarks: BookmarkEntry[];
  onNavigate: (url: string) => void;
  onRemoveHistory: (id: string) => void;
  onRemoveBookmark: (id: string) => void;
};

function faviconSrc(entry: { favicon?: string }): string | null {
  return entry.favicon && entry.favicon.startsWith("http") ? entry.favicon : null;
}

export function BrowserLibraryPanel({
  mode,
  history,
  bookmarks,
  onNavigate,
  onRemoveHistory,
  onRemoveBookmark,
}: Props): ReactNode {
  const t = useI18n();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<HistoryGroupKey, boolean>>({
    today: false,
    week: false,
    older: false,
  });

  const filteredHistory = useMemo(() => filterEntries(history, query), [history, query]);
  const filteredBookmarks = useMemo(() => filterEntries(bookmarks, query), [bookmarks, query]);
  const historyGroups = useMemo(
    () => groupHistoryByRecency(filteredHistory),
    [filteredHistory],
  );

  function toggleGroup(key: HistoryGroupKey): void {
    setCollapsed((current) => ({ ...current, [key]: !current[key] }));
  }

  function renderRemoveAction(
    onRemove: (id: string) => void,
    id: string,
  ): ReactNode {
    return (
      <Button
        type="text"
        shape="circle"
        size="small"
        className={styles.rowAction}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(id);
        }}
        icon={<TrashOutline size={14} />}
      />
    );
  }

  return (
    <div className={`library-panel ${styles.libraryPanel}`}>
      <div className={styles.searchWrap}>
        <Input
          size="small"
          allowClear
          value={query}
          placeholder={t.search}
          prefix={<SearchOutline size={16} />}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className={styles.listScroll}>
        {mode === "history" ? (
          historyGroups.length ? (
            historyGroups.map((group) => (
              <div key={group.key} className={styles.group}>
                <button
                  type="button"
                  className={styles.groupHead}
                  onClick={() => toggleGroup(group.key)}
                >
                  {collapsed[group.key] ? (
                    <ChevronForwardOutline size={14} />
                  ) : (
                    <ChevronDownOutline size={14} />
                  )}
                  <span>{group.label}</span>
                </button>
                {collapsed[group.key] ? null : (
                  <div>
                    {group.items.map((item) => {
                      const favicon = faviconSrc(item);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={styles.row}
                          onClick={() => onNavigate(item.url)}
                        >
                          {favicon ? (
                            <img className={styles.fav} src={favicon} alt="" />
                          ) : (
                            <EarthOutline
                              className={styles.favFallback}
                              size={16}
                            />
                          )}
                          <span className={styles.label}>{item.title || item.url}</span>
                          {renderRemoveAction(onRemoveHistory, item.id)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t.noHistory}
              style={{ padding: "40px 16px" }}
            />
          )
        ) : filteredBookmarks.length ? (
          filteredBookmarks.map((item) => {
            const favicon = faviconSrc(item);
            return (
              <button
                key={item.id}
                type="button"
                className={styles.row}
                onClick={() => onNavigate(item.url)}
              >
                {favicon ? (
                  <img className={styles.fav} src={favicon} alt="" />
                ) : (
                  <EarthOutline
                    className={styles.favFallback}
                    size={16}
                  />
                )}
                <span className={styles.label}>{item.title || item.url}</span>
                {renderRemoveAction(onRemoveBookmark, item.id)}
              </button>
            );
          })
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t.noBookmarks}
            style={{ padding: "40px 16px" }}
          />
        )}
      </div>
    </div>
  );
}

export default BrowserLibraryPanel;
