/* Service worker minimal — notifications push Flenova */
self.addEventListener('push', (event) => {
    let data = { title: 'Flenova', body: 'Nouvelle notification', url: '/' };
    try {
        if (event.data) data = { ...data, ...event.data.json() };
    } catch {
        try {
            data.body = event.data?.text() || data.body;
        } catch { /* ignore */ }
    }
    event.waitUntil(
        self.registration.showNotification(data.title || 'Flenova', {
            body: data.body || '',
            icon: '/favicon.ico',
            data: { url: data.url || '/' }
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            for (const client of list) {
                if ('focus' in client) {
                    client.navigate?.(url);
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(url);
            return undefined;
        })
    );
});
