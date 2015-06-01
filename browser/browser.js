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

//
// Walking
//

function StreamContents(stream) {
  this.stream = stream;
}

function Node(obj, name, depth, ref) {
  this.obj = obj;
  this.name = name;
  this.depth = depth;
  this.ref = ref;
}

Node.prototype = {
  get children() {
    var depth = this.depth + 1;
    var obj = this.obj;
    var children = [];
    if (isDict(obj) || isStream(obj)) {
      var map;
      if (isDict(obj)) {
        map = obj.map;
      } else {
        map = obj.dict.map;
      }
      for (var key in map) {
        var value = map[key];
        children.push(new Node(value, key, depth));
      }
      if (isStream(obj)) {
        children.push(new Node(new StreamContents(obj), 'Contents', depth));
      }
    } else if (isArray(obj)) {
      for (var i = 0, ii = obj.length; i < ii; i++) {
        var value = obj[i];
        children.push(new Node(value, i, depth));
      }
    }
    return children;
  }
};

function createWalker(data, root) {
  var pdf = new PDFDocument(null, data);
  pdf.parseStartXRef();
  pdf.parse();
  var xref = pdf.xref;
  if (!root || root === 'trailer') {
    root = xref.trailer;
  } else {
    var ref = new Ref(root.num, root.gen);
    root = xref.fetch(ref);
  }

  function addChildren(node, nodesToVisit) {
    var children = node.children;
    for (var i = children.length - 1; i >= 0; i--) {
      nodesToVisit.push(children[i]);
    }
  }

  function walk(nodesToVisit, visit) {
    while (nodesToVisit.length) {
      var currentNode = nodesToVisit.pop();
      if (currentNode.depth > 20) {
        throw new Error('Max depth exceeded.');
      }

      if (isRef(currentNode.obj)) {
        var fetched = xref.fetch(currentNode.obj);
        currentNode = new Node(fetched, currentNode.name, currentNode.depth, currentNode.obj);
      }
      var visitChildren = visit(currentNode, function (currentNode, visit) {
        walk(currentNode.children.reverse(), visit);
      }.bind(null, currentNode));

      if (visitChildren) {
        addChildren(currentNode, nodesToVisit);
      }
    }
  }

  return {
    start: function (visit) {
      var node;
      if (!ref) {
        node = [new Node(root, 'Trailer', 0)];
      } else {
        node = [new Node(root, '', 0, ref)];
      }
      walk(node, visit);
    }
  };
}

//
// Tree decoration.
//

function toText(node) {
  var name = node.name;
  var obj = node.obj;
  var description = '';
  if (isDict(obj)) {
    description = name + ' (dict)';
  } else if (isArray(obj)) {
    description = name + ' (array)';
  } else if (isStream(obj)) {
    description = name + ' (stream)';
  } else if (isName(obj)) {
    description = name + ' = /' + obj.name;
  } else if (isNum(obj)) {
    description = name + ' = ' + obj;
  } else if (isBool(obj)) {
    description = name + ' = ' + obj;
  } else if (isString(obj)) {
    if (obj.startsWith('\u00FE\u00FF')) {
      // Text encoded as UTF-16BE bytes, see §7.9.2.2 "Text String Type" of PDF 32000-1:2008
      // https://wwwimages2.adobe.com/content/dam/Adobe/en/devnet/pdf/pdfs/PDF32000_2008.pdf#G6.1957385
      var decoded = '';
      for (var i = 2; i < obj.length; i += 2) {
        decoded += String.fromCharCode(obj.charCodeAt(i) << 8 | obj.charCodeAt(i + 1));
      }
      obj = decoded;
    }
    description = name + ' = ' + JSON.stringify(obj) + '';
  } else if (obj instanceof StreamContents) {
    description = '<contents>';
  } else {
    console.log(obj);
    throw new Error('Unknown obj');
  }

  if (node.ref) {
    description += ' [id: ' + node.ref.num + ', gen: ' + node.ref.gen + ']';
  }
  return description;
}

function PrettyPrint() {
  this.out = '';
  this.refSet = new RefSet();
}

PrettyPrint.prototype.visit = function (node) {
  var depth = node.depth;
  this.out += ' '.repeat(depth) + toText(node);
  if (node.ref) {
    if (this.refSet.has(node.ref)) {
      return false;
    }
    this.refSet.put(node.ref);
  }
  this.out += '\n';
  return true;
}

function expando(clickEl, li, element, loadCallback) {
  li.classList.add('expando');
  li.appendChild(element);
  var expanded = false;
  var loaded = false;
  clickEl.addEventListener('click', function () {
    expanded = !expanded;
    if (expanded) {
      li.classList.add('expanded');
    } else {
      li.classList.remove('expanded');
    }
    if (!loaded) {
      loadCallback();
      loaded = true;
      return;
    }
  }.bind(this));
}

function HtmlPrint(ul) {
  this.ul = ul;
}

HtmlPrint.prototype.visit = function (ul, node, walk) {
  var obj = node.obj;

  var description = toText(node);

  var li = document.createElement('li');
  var span = document.createElement('span');
  span.textContent = description;
  li.appendChild(span);

  if (isDict(obj) || isStream(obj) || isArray(obj)) {
    var newUl = document.createElement('ul');
    expando(span, li, newUl, function () {
      walk(this.visit.bind(this, newUl));
    }.bind(this));
  } else if (obj instanceof StreamContents) {
    span.textContent = '<view contents> ';
    var pre = document.createElement('pre');
    var a = document.createElement('a');
    a.textContent = 'download';
    var bytes = obj.stream.getBytes();
    var string = '';
    for (var i = 0; i < bytes.length; i++) {
      string += String.fromCharCode(bytes[i]);
    }
    a.href = 'data:;base64,' + btoa(string);
    a.addEventListener('click', function(event) {
      event.stopPropagation();
    });
    span.appendChild(a);
    expando(span, li, pre, function () {
      pre.textContent = string;
    });
  }
  ul.appendChild(li);

  return false;
};

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
  var w = createWalker(data, root);

  var ul = document.getElementById('main');
  if (ul) {
    ul.textContent = '';
  } else {
    ul = document.createElement('ul');
    ul.id = 'main';
    document.body.appendChild(ul);
  }

  var hp = new HtmlPrint(ul);
  w.start(hp.visit.bind(hp, hp.ul));
  // var pp = new PrettyPrint();
  // w.start(pp.visit.bind(pp));
  // console.log(pp.out);

  // Expand first level.
  document.querySelector('.expando > span').click();
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


