/* Restored VOXA hub. Existing layouts and local collections are preserved.
   Unconnected services show their actual availability. */

window.makeClone = function (c) {
  const { esc, store, toast, $, incidents, S, pill, PRI, STATUS, fmt } = c;
  const ic = g => `<div class="ic">${g}</div>`;
  const soon = (title, desc) => () => `<div class="wrapv"><p class="report-eyebrow">Platform tools</p><h1>${esc(title)}</h1><p class="sub">${esc(desc)}</p><div class="panelx"><h3>Not connected</h3><p>This section is available to browse. Its processing service is not connected in this workspace.</p><div class="row-actions"><a class="btn" href="#/analyze">Analyze media</a><a class="btn sec" href="#/settings">View services</a></div></div></div>`;

  /* ---------- navigation (matches the hub sidebars) ---------- */
  const TABS = [
    { id: 'detect', label: 'Detect Platform', icon: '🛡', home: '#/call-safety' },
    { id: 'live', label: 'Live Monitor', icon: '', home: '#/live' },
    { id: 'reports', label: 'Reports', icon: '', home: '#/incidents' }
  ];
  const SIDE = {
    detect: { cta: 'Analyze media', ctaHref: '#/analyze', groups: [
      ['Overview', [['Dashboard', '⌂', '#/call-safety'], ['Analyze media', '', '#/analyze'], ['History', '', '#/history']]],
      ['Products', [['Meetings', '▭', '#/meetings'], ['Deepfake Detect Reports', '◉', '#/reports'], ['Chrome Extension', '◍', '#/chrome-extension'], ['Integrations', '▦', '#/integrations']]],
      ['Models', [['Intelligence', '◎', '#/intelligence'], ['Signal', '⛉', '#/signal'], ['Watermarking', '⚑', '#/watermarking'], ['Noise reduction', '', '#/noise']]],
      ['Manage', [['API Keys', '⚷', '#/api-keys'], ['Manage Team', '☷', '#/team'], ['Settings', '⚙', '#/settings']]]] }
  };

  SIDE.live = {cta:'Start monitoring',ctaHref:'#/live',groups:[['Live',[['Live monitor','','#/live'],['Live sessions','','#/incidents/live']]],['Manage',[['Settings','','#/settings']]]]};
  SIDE.reports = {cta:'Analyze media',ctaHref:'#/analyze',groups:[['Reports',[['History','','#/history'],['All reports','','#/incidents'],['Uploaded media','','#/incidents/uploaded'],['Live sessions','','#/incidents/live'],['Deepfake Detect Reports','','#/reports']]],['Quality',[['Evaluation','','#/evaluation']]],['Manage',[['Settings','','#/settings']]]]};
  const Reports = () => {
    const list = incidents();
    return `<div class="wrapv" style="max-width:920px"><div class="hdr-card"><div><div class="tagrow"><span class="tagx">VERIFY WHAT'S REAL</span></div>
      <h1 class="hero-h" style="text-align:left;font-size:30px;margin:14px 0 8px">Deepfake Detect Reports</h1>
      <p class="sub" style="margin:0;max-width:520px">Review media authenticity, available transcripts and fraud indicators with an explanation of each result.</p></div>
      <div class="row-actions" style="margin:0;align-self:flex-end"><a class="btn sec mint caps" href="#/integrations">CONNECT STORAGE</a><a class="btn caps" href="#/analyze">＋ NEW REPORT</a></div></div>
      <div class="free">🎁 <div><b>Upload to get started.</b><br><small>Upload any audio, video, or image.</small></div></div>
      <div class="panelx" style="padding:22px"><div class="eyebrow">Detection results</div><h2 style="font-weight:400;margin:4px 0">Reports <span class="count">${list.length} result${list.length === 1 ? '' : 's'}</span></h2>
      <p class="sub" style="font-size:12px">Investigations stay grouped by day so recent work is always at the top and historic results remain easy to scan.</p>
      ${list.length ? `<div class="tw"><table class="t"><thead><tr><th>ID</th><th>Date</th><th>Type</th><th>Sector</th><th>Priority</th><th>Status</th></tr></thead><tbody>${list.map(i => `<tr class="click" data-open="${esc(i.id)}"><td><a class="link" href="#/incident/${esc(i.id)}">${esc(i.id)}</a></td><td>${fmt(i.at)}</td><td>${esc({ image: 'Image', video: 'Video' }[i.modality] || 'Voice')}</td><td>${esc(S[i.sector]?.name || i.sector)}</td><td>${pill(PRI, i.priority)}</td><td>${pill(STATUS, i.status)}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty-box"><div class="inbox">▭</div><b>No reports yet</b><p>Upload your first audio, video, or image file to start building this review queue.</p></div>`}</div></div>`;
  };


  const Profile = ctx => `<div class="wrapv"><p class="report-eyebrow">Your workspace</p><h1>Workspace details</h1><p class="sub">A local session on this device. No hosted account is created.</p><div class="panelx"><dl class="kv"><dt>Display name</dt><dd>${esc(ctx.session.name)}</dd><dt>Session type</dt><dd>Local demo workspace</dd><dt>Default retention</dt><dd>This tab session, with optional 24-hour report retention.</dd></dl></div><div class="row-actions"><a class="btn" href="#/analyze">Analyze a call</a><a class="btn sec" href="#/settings">Privacy &amp; services</a></div></div>`;
  const ApiKeys = () => `<div class="wrapv"><h1>API Keys</h1><div class="panelx"><p>Provider keys are configured on the local server and are never displayed in this workspace. VOXA does not issue public API keys.</p><a class="btn" href="#/settings">View configured services</a></div></div>`;

  return {
    TABS, SIDE,
    titles:{dashboard:'Dashboard',meetings:'Meetings',reports:'Deepfake Detect Reports','chrome-extension':'Chrome Extension',integrations:'Integrations',intelligence:'Intelligence',signal:'Signal',watermarking:'Watermarking',team:'Manage Team','api-keys':'API Keys'},
    views: {
      reports: [Reports],
      team: [soon('Manage Team', 'This is a local workspace. Hosted team invitations and shared accounts are not connected.')],
      'api-keys': [ApiKeys],
      profile: [Profile]
    }
  };
};
