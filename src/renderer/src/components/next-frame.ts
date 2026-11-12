/**
 * 等一帧让 DOM 落地。窗口隐藏/最小化时 rAF 不会回调，必须有超时兜底，
 * 否则 await 这一句的流程会永久挂住。
 */
export function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    timer = window.setTimeout(finish, 80);
    requestAnimationFrame(finish);
  });
}
