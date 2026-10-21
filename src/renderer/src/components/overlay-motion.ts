/**
 * antd 下拉菜单的进出场默认带「缩放 + 淡入」动画。
 *
 * 动画期间弹层按 transform-origin 缩放：顶边会偏移几十像素（看着像菜单弹在了错的位置），
 * 0% 帧的 opacity 为 0 还会闪一下全透明，壁纸磨砂底也会随之失效。
 * 这里统一关掉下拉菜单的动画，菜单直接以最终位置出现、消失。
 */
export const NO_OVERLAY_MOTION = { transitionName: "" } as const;
