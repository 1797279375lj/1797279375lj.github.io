/* 陆骏个人 CRM（本地版）
 * 数据只存浏览器 localStorage，不经过任何服务器。
 * 数据层函数与界面层分离，数据层可在 Node 中单测。
 */
(function (global) {
  'use strict';

  var STAGES = ['线索', '已联系', '需求确认', '报价中', '谈判中', '已成交', '已流失'];
  var TERMINAL = ['已成交', '已流失'];
  var KEY = 'juns_crm_v1';

  function todayStr(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return todayStr(d);
  }
  function emptyState() { return { seq: 0, customers: [] }; }

  function load(storage) {
    try {
      var raw = storage.getItem(KEY);
      if (!raw) return emptyState();
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.customers)) return emptyState();
      return data;
    } catch (e) { return emptyState(); }
  }
  function save(storage, state) { storage.setItem(KEY, JSON.stringify(state)); }

  function addCustomer(state, data) {
    state.seq += 1;
    var now = new Date().toISOString();
    var c = {
      id: 'c' + state.seq,
      company: (data.company || '').trim(),
      contact: data.contact || '', title: data.title || '',
      phone: data.phone || '', wechat: data.wechat || '',
      industry: data.industry || '', region: data.region || '',
      stage: STAGES.indexOf(data.stage) >= 0 ? data.stage : '线索',
      level: ['A', 'B', 'C'].indexOf(data.level) >= 0 ? data.level : 'B',
      source: data.source || '',
      amount: Number(data.amount) || 0,
      lastContact: data.lastContact || '', nextFollow: data.nextFollow || '',
      notes: data.notes || '', logs: [],
      createdAt: now, updatedAt: now
    };
    if (!c.company) throw new Error('公司名称必填');
    state.customers.push(c);
    return c;
  }
  function findCustomer(state, id) {
    for (var i = 0; i < state.customers.length; i++) if (state.customers[i].id === id) return state.customers[i];
    return null;
  }
  function updateCustomer(state, id, data) {
    var c = findCustomer(state, id);
    if (!c) return null;
    ['company', 'contact', 'title', 'phone', 'wechat', 'industry', 'region', 'source', 'notes', 'lastContact', 'nextFollow'].forEach(function (k) {
      if (data[k] !== undefined) c[k] = data[k];
    });
    if (data.stage && STAGES.indexOf(data.stage) >= 0) c.stage = data.stage;
    if (data.level && ['A', 'B', 'C'].indexOf(data.level) >= 0) c.level = data.level;
    if (data.amount !== undefined) c.amount = Number(data.amount) || 0;
    c.updatedAt = new Date().toISOString();
    return c;
  }
  function deleteCustomer(state, id) {
    var before = state.customers.length;
    state.customers = state.customers.filter(function (c) { return c.id !== id; });
    return state.customers.length < before;
  }
  function addLog(state, id, log) {
    var c = findCustomer(state, id);
    if (!c) return null;
    var entry = {
      date: log.date || todayStr(),
      type: log.type || '电话',
      content: (log.content || '').trim()
    };
    if (!entry.content) throw new Error('跟进内容必填');
    c.logs.push(entry);
    c.lastContact = entry.date;
    if (log.nextFollow) c.nextFollow = log.nextFollow;
    if (log.stage && STAGES.indexOf(log.stage) >= 0) c.stage = log.stage;
    c.updatedAt = new Date().toISOString();
    return entry;
  }
  function isOverdue(c, today) {
    return !!c.nextFollow && c.nextFollow < today && TERMINAL.indexOf(c.stage) < 0;
  }
  function isDueSoon(c, today) {
    return !!c.nextFollow && !isOverdue(c, today) && c.nextFollow <= addDays(today, 7) && TERMINAL.indexOf(c.stage) < 0;
  }
  function computeStats(customers, today) {
    var s = { total: customers.length, active: 0, due: 0, overdue: 0, won: 0, activeAmount: 0, byStage: {} };
    STAGES.forEach(function (st) { s.byStage[st] = 0; });
    customers.forEach(function (c) {
      s.byStage[c.stage] = (s.byStage[c.stage] || 0) + 1;
      if (TERMINAL.indexOf(c.stage) < 0) { s.active += 1; s.activeAmount += c.amount || 0; }
      if (c.stage === '已成交') s.won += 1;
      if (isOverdue(c, today)) s.overdue += 1;
      else if (isDueSoon(c, today)) s.due += 1;
    });
    return s;
  }
  function filterCustomers(customers, opts) {
    var q = (opts.q || '').trim().toLowerCase();
    var stage = opts.stage || '';
    var list = customers.filter(function (c) {
      if (stage && c.stage !== stage) return false;
      if (!q) return true;
      var hay = [c.company, c.contact, c.industry, c.region, c.source, c.notes].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    var sort = opts.sort || 'nextFollow';
    list.sort(function (a, b) {
      if (sort === 'amount') return (b.amount || 0) - (a.amount || 0);
      if (sort === 'created') return b.createdAt < a.createdAt ? -1 : 1;
      if (sort === 'updated') return b.updatedAt < a.updatedAt ? -1 : 1;
      var af = a.nextFollow || '9999-12-31', bf = b.nextFollow || '9999-12-31';
      return af < bf ? -1 : af > bf ? 1 : 0;
    });
    return list;
  }
  function csvCell(v) {
    v = v === undefined || v === null ? '' : String(v);
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function toCSV(customers) {
    var head = ['公司名称', '联系人', '职务', '电话', '微信', '行业', '地区', '阶段', '等级', '来源', '预计金额', '上次联系', '下次跟进', '跟进次数', '备注'];
    var lines = [head.map(csvCell).join(',')];
    customers.forEach(function (c) {
      lines.push([c.company, c.contact, c.title, c.phone, c.wechat, c.industry, c.region, c.stage, c.level, c.source, c.amount, c.lastContact, c.nextFollow, c.logs.length, c.notes].map(csvCell).join(','));
    });
    return '﻿' + lines.join('\r\n');
  }
  function sampleData() {
    return [
      { company: '示例：杭州精工控制柜有限公司', contact: '王经理', title: '采购经理', phone: '', wechat: '', industry: '控制柜', region: '杭州', stage: '报价中', level: 'A', source: '自主开发', amount: 300000, lastContact: todayStr(), nextFollow: addDays(todayStr(), 2), notes: '示例数据，可删除。关注工业电源选型，已发规格书。' },
      { company: '示例：浙江安防设备有限公司', contact: '李工', title: '技术负责人', phone: '', wechat: '', industry: '安防监控', region: '浙江', stage: '已联系', level: 'B', source: '官网留资', amount: 80000, lastContact: addDays(todayStr(), -6), nextFollow: addDays(todayStr(), -1), notes: '示例数据，可删除。初步沟通了需求，等对方确认数量。' },
      { company: '示例：苏州新能源科技有限公司', contact: '张总', title: '老板', phone: '', wechat: '', industry: '储能', region: '苏州', stage: '线索', level: 'C', source: '转介绍', amount: 0, lastContact: '', nextFollow: addDays(todayStr(), 5), notes: '示例数据，可删除。刚拿到联系方式，还没正式联系。' }
    ];
  }

  var api = {
    STAGES: STAGES, TERMINAL: TERMINAL, KEY: KEY,
    todayStr: todayStr, addDays: addDays, emptyState: emptyState,
    load: load, save: save, addCustomer: addCustomer, findCustomer: findCustomer,
    updateCustomer: updateCustomer, deleteCustomer: deleteCustomer, addLog: addLog,
    isOverdue: isOverdue, isDueSoon: isDueSoon, computeStats: computeStats,
    filterCustomers: filterCustomers, toCSV: toCSV, sampleData: sampleData
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.JunsCRM = api;

  /* ============ 界面层（仅浏览器） ============ */
  if (typeof document === 'undefined') return;

  var storage = window.localStorage;
  var state = load(storage);
  var currentStage = '';
  var editingId = null;
  var logCustomerId = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function persist() { save(storage, state); }
  function fmtMoney(n) { return '¥' + Number(n || 0).toLocaleString('zh-CN'); }

  function renderStats() {
    var s = computeStats(state.customers, todayStr());
    $('statTotal').textContent = s.total;
    $('statActive').textContent = s.active;
    $('statDue').textContent = s.due;
    $('statOverdue').textContent = s.overdue;
    $('statWon').textContent = s.won;
    $('statAmount').textContent = fmtMoney(s.activeAmount);
  }
  function renderFunnel() {
    var s = computeStats(state.customers, todayStr());
    var html = '<button class="chip' + (currentStage === '' ? ' active' : '') + '" data-stage="">全部<span class="n">' + s.total + '</span></button>';
    STAGES.forEach(function (st) {
      html += '<button class="chip' + (currentStage === st ? ' active' : '') + '" data-stage="' + st + '">' + st + '<span class="n">' + (s.byStage[st] || 0) + '</span></button>';
    });
    $('funnel').innerHTML = html;
  }
  function stageBadge(c) {
    var cls = c.stage === '已成交' ? 'badge won' : c.stage === '已流失' ? 'badge lost' : 'badge';
    return '<span class="' + cls + '">' + esc(c.stage) + '</span>';
  }
  function renderList() {
    var today = todayStr();
    var list = filterCustomers(state.customers, {
      q: $('searchInput').value, stage: currentStage, sort: $('sortSelect').value
    });
    $('emptyState').hidden = state.customers.length > 0;
    $('customerList').innerHTML = list.map(function (c) {
      var overdue = isOverdue(c, today), due = isDueSoon(c, today);
      var lastLog = c.logs.length ? c.logs[c.logs.length - 1] : null;
      var followHtml = c.nextFollow
        ? '<span class="' + (overdue ? 'follow-overdue' : due ? 'follow-due' : '') + '">下次跟进：' + esc(c.nextFollow) + (overdue ? '（已逾期）' : due ? '（7 天内）' : '') + '</span>'
        : '<span>下次跟进：未设置</span>';
      var meta = [];
      if (c.contact) meta.push('联系人 <b>' + esc(c.contact) + (c.title ? '（' + esc(c.title) + '）' : '') + '</b>');
      if (c.phone) meta.push('电话 <b>' + esc(c.phone) + '</b>');
      if (c.wechat) meta.push('微信 <b>' + esc(c.wechat) + '</b>');
      if (c.industry) meta.push(esc(c.industry));
      if (c.region) meta.push(esc(c.region));
      if (c.source) meta.push('来源 ' + esc(c.source));
      return '<article class="customer-card' + (overdue ? ' overdue' : due ? ' duesoon' : '') + '">' +
        '<div class="card-top"><h3>' + esc(c.company) + '</h3>' + stageBadge(c) +
        '<span class="badge level">' + esc(c.level) + ' 级</span>' +
        (c.amount ? '<span class="badge">预计 ' + fmtMoney(c.amount) + '</span>' : '') + '</div>' +
        (meta.length ? '<p class="card-meta">' + meta.join(' · ') + '</p>' : '') +
        '<div class="card-dates"><span>上次联系：' + (esc(c.lastContact) || '—') + '</span>' + followHtml + '</div>' +
        (c.notes ? '<p class="card-notes">' + esc(c.notes) + '</p>' : '') +
        (lastLog ? '<p class="last-log">最近跟进（' + esc(lastLog.date) + ' · ' + esc(lastLog.type) + '）：' + esc(lastLog.content) + '</p>' : '') +
        '<div class="card-actions">' +
        '<button class="btn btn-mini" data-act="log" data-id="' + c.id + '">＋ 跟进记录（' + c.logs.length + '）</button>' +
        '<button class="btn btn-mini" data-act="edit" data-id="' + c.id + '">编辑</button>' +
        '<button class="btn btn-mini btn-danger-ghost" data-act="del" data-id="' + c.id + '">删除</button>' +
        '</div></article>';
    }).join('');
  }
  function render() { renderStats(); renderFunnel(); renderList(); }

  function fillStageSelect(sel, withEmpty) {
    sel.innerHTML = (withEmpty ? '<option value="">不调整</option>' : '') +
      STAGES.map(function (st) { return '<option value="' + st + '">' + st + '</option>'; }).join('');
  }
  function openCustomerModal(c) {
    editingId = c ? c.id : null;
    $('customerModalTitle').textContent = c ? '编辑客户' : '新增客户';
    var f = $('customerForm');
    f.reset();
    fillStageSelect($('stageSelect'), false);
    if (c) {
      ['company', 'contact', 'title', 'phone', 'wechat', 'industry', 'region', 'stage', 'level', 'source', 'amount', 'lastContact', 'nextFollow', 'notes'].forEach(function (k) {
        if (f.elements[k]) f.elements[k].value = c[k] === undefined ? '' : c[k];
      });
    }
    $('customerModal').hidden = false;
  }
  function openLogModal(c) {
    logCustomerId = c.id;
    $('logModalTitle').textContent = '跟进记录 · ' + c.company;
    fillStageSelect($('logStageSelect'), true);
    var f = $('logForm');
    f.reset();
    f.elements.date.value = todayStr();
    renderLogs(c);
    $('logModal').hidden = false;
  }
  function renderLogs(c) {
    var logs = c.logs.slice().reverse();
    $('logList').innerHTML = logs.length
      ? logs.map(function (l) {
          return '<div class="log-item"><div class="log-head"><b>' + esc(l.date) + '</b> · ' + esc(l.type) + '</div>' + esc(l.content) + '</div>';
        }).join('')
      : '<p style="color:var(--grey);font-size:13.5px">暂无跟进记录，在下方添加第一条。</p>';
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    render();

    $('funnel').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-stage]');
      if (!btn) return;
      currentStage = btn.getAttribute('data-stage');
      render();
    });
    $('searchInput').addEventListener('input', renderList);
    $('sortSelect').addEventListener('change', renderList);

    $('btnAdd').addEventListener('click', function () { openCustomerModal(null); });
    $('btnSample').addEventListener('click', function () {
      if (state.customers.length && !window.confirm('载入示例会追加 3 条示例客户，继续吗？')) return;
      sampleData().forEach(function (d) { addCustomer(state, d); });
      persist(); render();
    });
    $('btnClear').addEventListener('click', function () {
      if (!state.customers.length) return;
      if (!window.confirm('确定要清空全部客户数据吗？建议先导出备份。此操作不可恢复。')) return;
      state = emptyState();
      persist(); render();
    });
    $('btnExportJson').addEventListener('click', function () {
      download('crm-backup-' + todayStr() + '.json', JSON.stringify(state, null, 2), 'application/json');
    });
    $('btnExportCsv').addEventListener('click', function () {
      download('crm-customers-' + todayStr() + '.csv', toCSV(state.customers), 'text/csv;charset=utf-8');
    });
    $('btnImport').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          if (!data || !Array.isArray(data.customers)) throw new Error('格式不对');
          if (!window.confirm('导入将覆盖当前全部数据（当前 ' + state.customers.length + ' 个客户 → 导入 ' + data.customers.length + ' 个），继续吗？')) return;
          state = { seq: Number(data.seq) || data.customers.length, customers: data.customers };
          persist(); render();
        } catch (err) { window.alert('导入失败：这不是有效的 CRM 备份文件。'); }
        e.target.value = '';
      };
      reader.readAsText(file);
    });

    $('customerList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var c = findCustomer(state, btn.getAttribute('data-id'));
      if (!c) return;
      var act = btn.getAttribute('data-act');
      if (act === 'edit') openCustomerModal(c);
      else if (act === 'log') openLogModal(c);
      else if (act === 'del') {
        if (window.confirm('删除客户「' + c.company + '」及其全部跟进记录吗？')) {
          deleteCustomer(state, c.id); persist(); render();
        }
      }
    });

    $('customerForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var data = {};
      ['company', 'contact', 'title', 'phone', 'wechat', 'industry', 'region', 'stage', 'level', 'source', 'amount', 'lastContact', 'nextFollow', 'notes'].forEach(function (k) { data[k] = fd.get(k); });
      try {
        if (editingId) updateCustomer(state, editingId, data);
        else addCustomer(state, data);
        persist(); render();
        $('customerModal').hidden = true;
      } catch (err) { window.alert(err.message); }
    });
    $('logForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      try {
        addLog(state, logCustomerId, {
          date: fd.get('date'), type: fd.get('type'), content: fd.get('content'),
          nextFollow: fd.get('nextFollow'), stage: fd.get('stage')
        });
        persist(); render();
        renderLogs(findCustomer(state, logCustomerId));
        e.target.reset();
        e.target.elements.date.value = todayStr();
      } catch (err) { window.alert(err.message); }
    });
    document.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { btn.closest('.modal-backdrop').hidden = true; });
    });
    document.querySelectorAll('.modal-backdrop').forEach(function (bd) {
      bd.addEventListener('click', function (e) { if (e.target === bd) bd.hidden = true; });
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
