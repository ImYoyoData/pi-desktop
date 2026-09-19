/** 关于页展示的贡献者名单，人工维护：发版前按 GitHub 仓库页与提交记录更新。 */

export type Contributor = {
  /** GitHub 用户名，同时作为头像与列表项的稳定标识。 */
  login: string;
  /** GitHub 昵称。 */
  name: string;
  avatarUrl: string;
  htmlUrl: string;
  /** 仓库内提交数。 */
  contributions: number;
  /** 首次提交日期，YYYY-MM-DD。 */
  firstCommit: string;
  /** 最近一次提交日期，YYYY-MM-DD。 */
  latestCommit: string;
  /** 仓库所有者标记。 */
  owner?: boolean;
};

export const CONTRIBUTORS: Contributor[] = [
  {
    login: "YueMian-u",
    name: "YueMian",
    avatarUrl: "https://github.com/YueMian-u.png?size=160",
    htmlUrl: "https://github.com/YueMian-u",
    contributions: 278,
    firstCommit: "2026-09-02",
    latestCommit: "2026-09-19",
  },
  {
    login: "ImYoyoData",
    name: "Yoyo",
    avatarUrl: "https://github.com/ImYoyoData.png?size=160",
    htmlUrl: "https://github.com/ImYoyoData",
    contributions: 175,
    firstCommit: "2026-07-26",
    latestCommit: "2026-09-14",
    owner: true,
  },
];
