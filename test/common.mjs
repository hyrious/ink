export function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const is_chrome =
  navigator &&
  navigator.userAgentData &&
  navigator.userAgentData.brands.some((e) => /chromium/i.test(e.brand));

if (!is_chrome) {
  document.getElementById("not-chrome").style.display = "";
}
