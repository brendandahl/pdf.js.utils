'use strict';

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

function StreamContents(stream) {
  this.stream = stream;
}

function walker(root) {
  var xref = root.xref;

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
        throw new Error('Depth too big.');
      }

      if (isRef(currentNode.obj)) {
        var fetched = xref.fetch(currentNode.obj);
        currentNode = new Node(fetched, currentNode.name, currentNode.depth, currentNode.obj);
      }
      var visitChildren = visit(currentNode);
      if (visitChildren) {
        addChildren(currentNode, nodesToVisit);
      }
    }
  }

  return {
    start: function (visit) {
      walk([new Node(root, 'Trailer', 0)], visit);
    },
    walk: walk
  };
}

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
  li.style.listStyleType = 'disc';
  li.appendChild(element);
  clickEl.style.cursor = 'pointer';
  var expanded = false;
  var loaded = false;
  clickEl.addEventListener('click', function () {
    expanded = !expanded;
    element.style.display = expanded ? 'block' : 'none';
    li.style.listStyleType = expanded ? 'circle' : 'disc';
    if (!loaded) {
      loadCallback();
      loaded = true;
      return;
    }
  }.bind(this));
}

function HtmlPrint() {
  this.ul = document.createElement('ul');
  this.ul.id = 'main';
  document.body.appendChild(this.ul);
}

HtmlPrint.prototype.visit = function (ul, node) {
  var obj = node.obj;

  var description = toText(node);

  var li = document.createElement('li');
  li.style.listStyleType = 'none';
  var span = document.createElement('span');
  span.textContent = description;
  li.appendChild(span);

  if (isDict(obj) || isStream(obj) || isArray(obj)) {
    var newUl = document.createElement('ul');
    expando(span, li, newUl, function () {
      this.walk(node.children.reverse(), this.visit.bind(this, newUl));
    }.bind(this));
  } else if (obj instanceof StreamContents) {
    var pre = document.createElement('pre');
    pre.style.marginTop = 0;
    pre.style.marginBottom = 0;
    expando(span, li, pre, function () {
      var bytes = obj.stream.getBytes();
      var string = '';
      for (var i = 0; i < bytes.length; i++) {
        string += String.fromCharCode(bytes[i]);
      }
      pre.textContent = string;
    });
  }
  ul.appendChild(li);

  return false;
};

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

    var pdf = new PDFDocument(null, uint8Array);
    pdf.parseStartXRef();
    pdf.parse();
    var w = walker(pdf.xref.trailer);
    var hp = new HtmlPrint();
    hp.walk = w.walk;
    w.start(hp.visit.bind(hp, hp.ul));
  };

  var file = files[0];
  fileReader.readAsArrayBuffer(file);

}, true);

// getData('/mine/pdf.js/test/pdfs/annotation-tx.pdf', function(data) {
//   var pdf = new PDFDocument(null, data);
//   pdf.parseStartXRef();
//   pdf.parse();
//   var w = walker(pdf.xref.trailer);
//   // var pp = new PrettyPrint();
//   // w.start(pp.visit.bind(pp));
//   // console.log(pp.out);
//   var hp = new HtmlPrint();
//   hp.walk = w.walk;
//   w.start(hp.visit.bind(hp, hp.ul));
//   window.pdf = pdf;
// });
