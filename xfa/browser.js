'use strict';

//
// Helper functions.
//

String.prototype.repeat = function (num) {
  return new Array(num + 1).join(this);
};

function getData(url, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.responseType = 'arraybuffer';
  xhr.onload = (function() {
    var data = new Uint8Array(xhr.response || xhr.mozResponseArrayBuffer);
    callback(data);
  }).bind(this);
  xhr.send(null);
}

function parseQueryString(query) {
  var parts = query.split('&');
  var params = {};
  for (var i = 0, ii = parts.length; i < parts.length; ++i) {
    var param = parts[i].split('=');
    var key = param[0];
    var value = param.length > 1 ? param[1] : null;
    params[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return params;
}

function stringToURL(typedArray, mimeType) {
  return URL.createObjectURL(new Blob([typedArray], {type: mimeType}))
}

function show(key, data, xref, div) {
  let stream = xref.fetchIfRef(data);
  let str = stringToUTF8String(bytesToString(stream.getBytes()));
  let link = document.createElement("a");
  link.href = stringToURL(str, "application/xml");
  link.textContent = "(raw)";
  let pre = document.createElement("pre");
  pre.textContent = prettifyXml(str);
  const title = document.createElement("h3");
  title.textContent = key;
  div.appendChild(title);
  div.appendChild(link);
  div.appendChild(pre);
}

function createWalker(data, root, div) {
  var pdf = new PDFDocument(null, data);
  pdf.parseStartXRef();
  pdf.parse();
  let xfa = pdf.acroForm.get("XFA");
  let xref = pdf.xref;
  for (let i = 0; i < xfa.length; i += 2) {
    show(xfa[i], xfa[i + 1], xref, div);
  }
}

function prettifyXml(sourceXml) {
  return new XmlBeautify().beautify(sourceXml);
}

var Browser = {};

function go(data) {
  Browser.data = data;
  var hash = document.location.hash.substring(1);
  var hashParams = parseQueryString(hash);
  var root = null;
  if (hashParams.root) {
    var split = hashParams.root.split(',');
    root = { num: split[0], gen: split[1] };
  }
  const div = document.getElementById("content");
  empty(div);
  var w = createWalker(data, root, div);
}

function empty(div) {
  while (div.firstChild) {
    div.removeChild(div.lastChild);
  }
}

window.addEventListener('change', function webViewerChange(evt) {
  var files = evt.target.files;
  if (!files || files.length === 0)
    return;

  // Read the local file into a Uint8Array.
  var fileReader = new FileReader();
  fileReader.onload = function webViewerChangeFileReaderOnload(evt) {
    var main = document.querySelector('#main');
    if (main) {
      document.body.removeChild(main);
    }
    var buffer = evt.target.result;
    var uint8Array = new Uint8Array(buffer);

    go(uint8Array);
  };

  var file = files[0];
  fileReader.readAsArrayBuffer(file);

}, true);

window.addEventListener('hashchange', function (evt) {
  go(Browser.data);
});

var params = parseQueryString(document.location.search.substring(1));
if (params.file) {
  getData(params.file, function(data) {
    go(data);
  });
}


