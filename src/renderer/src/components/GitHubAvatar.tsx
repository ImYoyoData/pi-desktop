import { useEffect, useState, type ReactNode } from "react";
import { avatarUrlOf, isBotLogin, loadGithubImage } from "@renderer/utils/github-image";
import styles from "./GitHubAvatar.module.css";

type Props = {
  login: string;
  src?: string;
  avatars?: Record<string, string>;
  size?: "sm" | "md" | "lg";
};

type LoadState = { url: string; dataUrl: string | null };

function BotIcon({ className }: { className?: string }): ReactNode {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 32,
  };
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      aria-hidden="true"
    >
      <rect x="80" y="80" width="352" height="352" rx="48" ry="48" {...stroke} />
      <rect x="144" y="144" width="224" height="224" rx="16" ry="16" {...stroke} />
      <path d="M256 80V48" {...stroke} />
      <path d="M336 80V48" {...stroke} />
      <path d="M176 80V48" {...stroke} />
      <path d="M256 464v-32" {...stroke} />
      <path d="M336 464v-32" {...stroke} />
      <path d="M176 464v-32" {...stroke} />
      <path d="M432 256h32" {...stroke} />
      <path d="M432 336h32" {...stroke} />
      <path d="M432 176h32" {...stroke} />
      <path d="M48 256h32" {...stroke} />
      <path d="M48 336h32" {...stroke} />
      <path d="M48 176h32" {...stroke} />
    </svg>
  );
}

export function GitHubAvatar({
  login,
  src = "",
  avatars = {},
  size = "md",
}: Props): ReactNode {
  const [loaded, setLoaded] = useState<LoadState | null>(null);
  const url = avatarUrlOf(login, avatars, src);
  const bot = isBotLogin(login);

  useEffect(() => {
    let active = true;
    if (!url) {
      return () => {
        active = false;
      };
    }
    void loadGithubImage(url).then((dataUrl) => {
      if (!active) return;
      setLoaded({ url, dataUrl });
    });
    return () => {
      active = false;
    };
  }, [url]);

  const dataUrl = loaded && loaded.url === url ? loaded.dataUrl : null;
  const failed = !url || (loaded !== null && loaded.url === url && loaded.dataUrl === null);

  return (
    <span
      className={`${styles.root} ${size} ${bot ? styles.bot : styles.round}`}
      title={login}
      aria-hidden="true"
    >
      {dataUrl ? (
        <img src={dataUrl} alt="" />
      ) : bot ? (
        <BotIcon className={styles.botIcon} />
      ) : failed ? (
        <span>{login.slice(0, 1).toUpperCase()}</span>
      ) : (
        <span className={styles.loading} />
      )}
    </span>
  );
}

export default GitHubAvatar;
