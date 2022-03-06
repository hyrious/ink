export function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const is_chrome =
  navigator &&
  navigator.userAgentData &&
  navigator.userAgentData.brands.some((e) => /chromium/i.test(e.brand));

const not_chrome = document.getElementById("not-chrome");
if (!is_chrome && not_chrome) {
  not_chrome.style.display = "";
}

if (typeof navigator < "u" && navigator.serviceWorker)
  navigator.serviceWorker.getRegistrations().then((rs) => {
    rs.forEach((r) => {
      r.unregister();
    });
  });
