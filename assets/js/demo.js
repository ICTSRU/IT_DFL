/* Demo backend: in-memory sample data so the UI can be previewed with ?demo=1 (no Google, no Drive). */
(function () {
  function today(offset) { var d = new Date(); d.setDate(d.getDate() - offset); return d.toISOString().slice(0, 10); }
  var drawers = [
    { id: 'DRW-0001', nameAr: 'السياسات', nameEn: 'Policies', icon: 'scroll-text', color: '#501e8c', order: 1, active: true, description: '' },
    { id: 'DRW-0002', nameAr: 'العقود', nameEn: 'Contracts', icon: 'file-signature', color: '#0a6eaa', order: 2, active: true, description: '' },
    { id: 'DRW-0003', nameAr: 'المشاريع', nameEn: 'Projects', icon: 'kanban', color: '#1f7a5c', order: 3, active: true, description: '' },
    { id: 'DRW-0004', nameAr: 'التقارير', nameEn: 'Reports', icon: 'chart-column', color: '#b4540a', order: 4, active: true, description: '' },
    { id: 'DRW-0005', nameAr: 'الموارد البشرية', nameEn: 'HR', icon: 'users', color: '#8a2a6b', order: 5, active: true, description: '' },
    { id: 'DRW-0006', nameAr: 'المشتريات', nameEn: 'Procurement', icon: 'shopping-cart', color: '#3a4a8a', order: 6, active: true, description: '' }
  ];
  var folderDefs = [
    [1, ['أمن المعلومات', 'Information Security'], ['تشغيل تقنية المعلومات', 'IT Operations'], ['الاستخدام المقبول', 'Acceptable Use']],
    [2, ['عقود سارية', 'Active Contracts'], ['عقود منتهية', 'Expired Contracts'], ['اتفاقيات عدم الإفصاح', 'NDAs']],
    [3, ['مشاريع جارية', 'Active Projects'], ['مشاريع مكتملة', 'Completed Projects'], ['مقترحات المشاريع', 'Project Proposals']],
    [4, ['تقارير أسبوعية', 'Weekly Reports'], ['تقارير شهرية', 'Monthly Reports'], ['تقارير سنوية', 'Annual Reports']],
    [5, ['الأوصاف الوظيفية', 'Job Descriptions'], ['التدريب', 'Training'], ['التقييمات', 'Evaluations']],
    [6, ['طلبات الشراء', 'Purchase Requests'], ['عروض الأسعار', 'Quotations'], ['أوامر الشراء', 'Purchase Orders']]
  ];
  var folders = [];
  folderDefs.forEach(function (d) {
    for (var i = 1; i < d.length; i++) {
      folders.push({ id: 'FLD-' + ('000' + (folders.length + 1)).slice(-4), drawerId: 'DRW-000' + d[0], nameAr: d[i][0], nameEn: d[i][1], order: i, active: true });
    }
  });
  var owners = ['Mohamed ElMahdy', 'Asma Alolayan', 'Ammar Alrowedan', 'Azzam Alaqeel'];
  var samples = [
    ['Information Security Policy v3', 0, 'pdf', ['security', 'iso27001', 'approved'], 'Internal'],
    ['Acceptable Use Policy', 2, 'docx', ['policy', 'users'], 'General'],
    ['Backup and Recovery Policy', 1, 'pdf', ['backup', 'dr'], 'Internal'],
    ['Oracle Fusion Support Agreement', 3, 'pdf', ['oracle', 'erp', 'vendor'], 'Confidential'],
    ['Network Maintenance Contract 2026', 3, 'pdf', ['network', 'maintenance'], 'Internal'],
    ['NDA — Cloud Provider', 5, 'pdf', ['nda', 'cloud'], 'Confidential'],
    ['Cloud Migration Plan', 6, 'docx', ['cloud', 'migration'], 'Internal'],
    ['Student Services Portal — Scope', 8, 'docx', ['portal', 'students'], 'Internal'],
    ['Weekly Status Report — Week 43', 9, 'pdf', ['weekly', 'noc'], 'Internal'],
    ['Monthly Operations Report — October', 10, 'xlsx', ['monthly', 'kpi'], 'Internal'],
    ['Annual IT Report 2025', 11, 'pdf', ['annual', 'president'], 'General'],
    ['Job Description — Network Engineer', 12, 'docx', ['jd', 'network'], 'Internal'],
    ['Cybersecurity Awareness Training Deck', 13, 'pdf', ['training', 'security'], 'General'],
    ['Purchase Request — Core Switch', 15, 'pdf', ['switch', 'capex'], 'Internal'],
    ['Quotation — Firewall Renewal', 16, 'pdf', ['firewall', 'renewal'], 'Internal']
  ];
  var docs = samples.map(function (s, i) {
    return { id: 'DOC-' + ('000' + (i + 1)).slice(-4), title: s[0], drawerId: folders[s[1]].drawerId, folderId: folders[s[1]].id, date: today(i * 9 + 2),
      owner: owners[i % owners.length], ownerEmail: '', tags: s[3], description: i % 3 === 0 ? 'Latest approved version, reviewed by the CIO office.' : '',
      version: '1.' + (i % 4), status: i === 2 ? 'Draft' : 'Active', conf: s[4], fileName: s[0].replace(/\s+/g, '_') + '.' + s[2], mime: '', size: 120000 + i * 87000,
      hasFile: true, createdBy: 'demo@sr.edu.sa', createdAt: today(i), updatedBy: '', updatedAt: '', canEdit: true };
  });
  var DEMO_USERS = [
    { email: 'demo@sr.edu.sa', name: 'Demo User', role: 'Admin', active: true, addedAt: today(20) },
    { email: 'nabounar@sr.edu.sa', name: 'Dr. Nasser Abounar', role: 'Admin', active: true, addedAt: today(15) },
    { email: 'asma@sr.edu.sa', name: 'Asma Alolayan', role: 'Editor', active: true, addedAt: today(8) },
    { email: 'viewer@sr.edu.sa', name: 'Sample Viewer', role: 'Viewer', active: false, addedAt: today(3) }
  ];
  var seq = { DRW: 6, FLD: folders.length, DOC: docs.length };
  function nid(p) { seq[p]++; return p + '-' + ('000' + seq[p]).slice(-4); }
  function find(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i; return -1; }

  window.DemoApi = function (action, p) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        var i;
        switch (action) {
          case 'bootstrap':
            return resolve(JSON.parse(JSON.stringify({ user: { email: 'demo@sr.edu.sa', name: 'Demo User', role: 'Admin' },
              config: { libraryName: 'ICTD Digital File Library', maxUploadMB: 20, defaultConf: 'Internal', version: '1.0' }, drawers: drawers, folders: folders, documents: docs })));
          case 'addDrawer': var d = { id: nid('DRW'), nameAr: p.nameAr, nameEn: p.nameEn, icon: p.icon, color: p.color, order: drawers.length + 1, active: true, description: p.description || '' };
            drawers.push(d); return resolve(d);
          case 'updateDrawer': i = find(drawers, p.id); Object.assign(drawers[i], { nameAr: p.nameAr, nameEn: p.nameEn, icon: p.icon, color: p.color, description: p.description, active: !!p.active, order: Number(p.order) || drawers[i].order }); return resolve(drawers[i]);
          case 'addFolder': var f = { id: nid('FLD'), drawerId: p.drawerId, nameAr: p.nameAr, nameEn: p.nameEn, order: 99, active: true }; folders.push(f); return resolve(f);
          case 'deleteFolder': {
            var fdocs = docs.filter(function (d) { return d.folderId === p.id; });
            if (fdocs.length && !p.force) return reject({ code: 'HAS_DOCS', message: String(fdocs.length) });
            var delIds = fdocs.map(function (d) { return d.id; });
            docs = docs.filter(function (d) { return d.folderId !== p.id; });
            folders = folders.filter(function (f) { return f.id !== p.id; });
            return resolve({ id: p.id, deletedDocs: delIds });
          }
          case 'updateFolder': i = find(folders, p.id); Object.assign(folders[i], { nameAr: p.nameAr, nameEn: p.nameEn, active: !!p.active, order: Number(p.order) || folders[i].order }); return resolve(folders[i]);
          case 'addDocument':
            if (!p.upload && !p.link) return reject({ code: 'VALIDATION', message: 'Please attach a file or paste a Google Drive link.' });
            var nd = { id: nid('DOC'), title: p.title, drawerId: p.drawerId, folderId: p.folderId, date: p.date, owner: p.owner, ownerEmail: p.ownerEmail || '', tags: p.tags || [],
              description: p.description || '', version: p.version || '1.0', status: p.status, conf: p.conf, fileName: p.upload ? p.upload.name : 'Google Drive link', mime: '',
              size: p.upload ? Math.round(p.upload.data.length * 0.75) : 0, hasFile: true, createdBy: 'demo@sr.edu.sa', createdAt: today(0), updatedBy: '', updatedAt: '', canEdit: true };
            docs.push(nd); return resolve(nd);
          case 'updateDocument': i = find(docs, p.id); Object.assign(docs[i], { title: p.title, drawerId: p.drawerId, folderId: p.folderId, date: p.date, owner: p.owner, tags: p.tags || [],
            description: p.description, version: p.version, status: p.status, conf: p.conf, updatedBy: 'demo@sr.edu.sa', updatedAt: today(0) }); return resolve(docs[i]);
          case 'deleteDocument': i = find(docs, p.id); docs.splice(i, 1); return resolve({ id: p.id });
          case 'openDocument': return resolve({ url: 'about:blank', granted: true, demo: true });
          case 'listUsers': return resolve({ users: DEMO_USERS.slice(), me: 'demo@sr.edu.sa' });
          case 'saveUser': {
            var em = String(p.email || '').toLowerCase().trim();
            var ex = DEMO_USERS.filter(function (x) { return x.email === em; })[0];
            if (ex) { ex.name = p.name !== undefined ? p.name : ex.name; ex.role = p.role || ex.role; ex.active = p.active !== undefined ? !!p.active : ex.active; }
            else DEMO_USERS.push({ email: em, name: p.name || '', role: p.role || 'Viewer', active: p.active !== undefined ? !!p.active : true, addedAt: today(0) });
            return resolve({ users: DEMO_USERS.slice(), me: 'demo@sr.edu.sa' });
          }
          case 'deleteUser': {
            DEMO_USERS = DEMO_USERS.filter(function (x) { return x.email !== String(p.email || '').toLowerCase().trim(); });
            return resolve({ users: DEMO_USERS.slice(), me: 'demo@sr.edu.sa' });
          }
        }
        reject({ code: 'BAD_REQUEST', message: 'Unknown action' });
      }, 120);
    });
  };
})();
