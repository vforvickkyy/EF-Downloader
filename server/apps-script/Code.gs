/**
 * Eastape Downloader relay (Google Apps Script web app).
 *
 * The app sends installation notices, registrations and support messages
 * here; this script emails them to Eastape Tech. The email addresses live only
 * in this script, never in the app. Setup steps: see README.md next to this
 * file.
 *
 * Script properties (Project Settings -> Script properties):
 *   RELAY_TOKEN  required. Must match the token built into the app.
 *   SHEET_ID     optional. A Google Sheet ID; every event is also logged
 *                there as a row (handy for counting installs).
 */

var INSTALLS_TO = 'tech@eastapefilms.com';
var SUPPORT_TO = 'info@eastapefilms.com';
var SENDER_NAME = 'Eastape Downloader';

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('RELAY_TOKEN');
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!token || body.token !== token) return reply_({ ok: false, error: 'unauthorized' });

    var ev = clean_(body.event || {});
    if (!rateOk_(ev)) return reply_({ ok: false, error: 'rate limited' });

    switch (ev.type) {
      case 'install':
      case 'update':
      case 'reinstall':
      case 'first_run':
        mailInstall_(ev);
        break;
      case 'register':
        mailRegister_(ev);
        break;
      case 'support':
        mailSupport_(ev);
        break;
      default:
        return reply_({ ok: false, error: 'unknown type' });
    }
    logRow_(props.getProperty('SHEET_ID'), ev);
    return reply_({ ok: true });
  } catch (err) {
    return reply_({ ok: false, error: String(err) });
  }
}

// Opening the URL in a browser shows that the relay is up.
function doGet() {
  return reply_({ ok: true, service: 'eastape-relay' });
}

function mailInstall_(ev) {
  var titles = {
    install: 'New installation',
    update: 'Updated',
    reinstall: 'Reinstalled',
    first_run: 'Portable copy started',
  };
  var subject = titles[ev.type] + ': Eastape Downloader ' + ev.appVersion + ' (' + ev.os + ')';
  var lines = [
    titles[ev.type] + ' of Eastape Downloader.',
    '',
    'Version:      ' + ev.appVersion + (ev.prevVersion ? '  (was ' + ev.prevVersion + ')' : ''),
    'Windows:      ' + ev.os,
    'Install ID:   ' + ev.installId,
    'Reported by:  ' + (ev.source || '-'),
    'Time (UTC):   ' + ev.time,
    '',
    'The user is asked for their name and email when the app first opens; a separate',
    '"New user" email follows when they register.',
  ];
  MailApp.sendEmail({ to: INSTALLS_TO, subject: subject, body: lines.join('\n'), name: SENDER_NAME });
}

function mailRegister_(ev) {
  var subject = 'New user: ' + ev.name + ' <' + ev.email + '>';
  var lines = [
    'A user registered Eastape Downloader.',
    '',
    'Name:         ' + ev.name,
    'Email:        ' + ev.email,
    'Version:      ' + ev.appVersion,
    'Windows:      ' + ev.os,
    'Install ID:   ' + ev.installId,
    'Time (UTC):   ' + ev.time,
  ];
  MailApp.sendEmail({ to: INSTALLS_TO, subject: subject, body: lines.join('\n'), name: SENDER_NAME, replyTo: ev.email });
}

function mailSupport_(ev) {
  var subject = '[Support] ' + (ev.topic || 'Message') + ' from ' + ev.name;
  var lines = [
    'From:     ' + ev.name + ' <' + ev.email + '>',
    'Topic:    ' + (ev.topic || '-'),
    'Version:  ' + ev.appVersion + ' on ' + ev.os,
    'Install:  ' + ev.installId,
    'Time:     ' + ev.time + ' (UTC)',
    '',
    ev.message,
  ];
  if (ev.details) {
    lines.push('', '---- Technical details (shared by the user) ----', ev.details);
  }
  lines.push('', 'Reply to this email to answer the user.');
  MailApp.sendEmail({ to: SUPPORT_TO, subject: subject, body: lines.join('\n'), name: SENDER_NAME, replyTo: ev.email });
}

// At most 20 events an hour per installation, 5 of them support messages.
function rateOk_(ev) {
  var cache = CacheService.getScriptCache();
  var key = 'rate:' + (ev.installId || 'none');
  var n = Number(cache.get(key) || 0);
  if (n >= 20) return false;
  cache.put(key, String(n + 1), 3600);
  if (ev.type === 'support') {
    var skey = 'support:' + (ev.installId || 'none');
    var s = Number(cache.get(skey) || 0);
    if (s >= 5) return false;
    cache.put(skey, String(s + 1), 3600);
  }
  return true;
}

var LIMITS = {
  type: 20, installId: 64, appVersion: 32, os: 64, time: 40, source: 20, prevVersion: 32,
  name: 100, email: 200, topic: 60, message: 5000, details: 20000,
};

function clean_(ev) {
  var out = {};
  Object.keys(LIMITS).forEach(function (k) {
    var v = ev[k] == null ? '' : String(ev[k]);
    // Keep new lines in long text; drop other control characters.
    v = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    if (k !== 'message' && k !== 'details') v = v.replace(/[\r\n]+/g, ' ');
    out[k] = v.trim().slice(0, LIMITS[k]);
  });
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) out.email = '';
  return out;
}

function logRow_(sheetId, ev) {
  if (!sheetId) return;
  try {
    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Time (UTC)', 'Event', 'Install ID', 'Version', 'Windows', 'Name', 'Email', 'Topic']);
    }
    sheet.appendRow([ev.time, ev.type, ev.installId, ev.appVersion, ev.os, ev.name, ev.email, ev.topic]);
  } catch (err) {
    // Logging is optional; never fail the request because of it.
  }
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
