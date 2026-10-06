export async function postChat(body) {
  const r = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok || !data.reply) throw new Error((data && data.error) || ('http ' + r.status));
  return data.reply;
}
