self.addEventListener("push", event => {
  let data;
  try { data = event.data?.json(); } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data?.title ?? "Saturn", { body: data?.body ?? "", tag: "saturn-alarm" }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window" }).then(windows => {
    const client = windows.find(client => new URL(client.url).origin === self.location.origin);
    return client ? client.focus() : self.clients.openWindow("/");
  }));
});
