chrome.storage.local.get('history').then(({ history = [] }) => {
  const ul = document.getElementById('list');
  if (!history.length) { ul.innerHTML = '<li><small>No checks yet.</small></li>'; return; }
  for (const h of history) {
    const li = document.createElement('li');
    const left = document.createElement('div'), right = document.createElement('b');
    left.textContent = h.kind + ' · ' + h.host;
    const sm = document.createElement('small'); sm.textContent = new Date(h.at).toLocaleString() + (h.error ? ' · ' + h.error : ''); left.appendChild(sm);
    right.textContent = h.label; right.className = h.label.startsWith('AI') ? 'AI' : h.label;
    li.append(left, right); ul.appendChild(li);
  }
});
