'use strict';

//
// Helper functions.
//

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

function assert(cond, message) {
  if (!cond) {
    throw new Error('Assert failed: ' + message);
  }
}

function pad(num, length) {
  var ret = num + '';
  while (ret.length < length) {
    ret = '0' + ret;
  }
  return ret;
}

function hasSpecialChar(str) {
  for (var i = 0, ii = str.length; i < ii; i++) {
    switch (str[i]) {
      case '(':
      case ')':
      case '\\':
      case '\n':
      case '\r':
      case '\t':
      case '\b':
      case '\f':
        return true;
    }
  }
  return false;
}

//
// Maker
//

var maker = (function () {

  function PDFOut() {
    this.output = '';
  }
  PDFOut.prototype = {
    write: function (data) {
      this.output += data;
    }
  };

  function RefManager(xref) {
    // Hack so we don't have any refs collide.
    this.id = xref.entries.length;
    this.map = {};
    this.offsets = {};
    this.offsetCount = 0;
    this.xref = xref;
  }
  RefManager.prototype = {
    create: function (obj) {
      var ref = new Ref(this.id++, 0);
      var str = ('R' + ref.num + '.' + ref.gen);
      var wrapper = {
        ref: ref,
        obj: obj
      };
      this.map[str] = wrapper;
      return wrapper;
    },
    get: function (ref) {
      assert(isRef(ref), 'must be ref');
      var str = ('R' + ref.num + '.' + ref.gen);
      var obj;
      if (str in this.map) {
        obj = this.map[str].obj;
      } else {
        obj = this.xref.fetch(ref);
      }
      return obj;
    },
    setOffset: function (ref, offset) {
      assert(ref.gen == 0, 'gen not 0');
      assert(!(ref.num in this.offsets), 'offset already set');
      this.offsets[ref.num] = offset;
      this.offsetCount++;
    }
  }

  function DictModel() {
    this.map = {};
  }

  function createHeader(out) {
    out.write('%PDF-1.7\n');
  }

  function visit(node, refsToVisit, visitedRefs) {
    if (isRef(node)) {
      if (!visitedRefs.has(node)) {
        visitedRefs.put(node);
        refsToVisit.unshift(node);
      }
      return node.num + ' ' + node.gen + ' R';
    } else if (isNum(node)) {
      return node;
    } else if (isBool(node)) {
      return node;
    } else if (isName(node)) {
      return '/' + node.name;
    } else if (isString(node)) {
      if (!hasSpecialChar(node)) {
        return '(' + node + ')';
      } else {
        var ret = '<';
        for (var i = 0; i < node.length; i++) {
          ret += pad(node.charCodeAt(i).toString(16), 2);
        }
        return ret + '>';
      }
    } else if (isArray(node)) {
      var ret = ['['];
      for (var i = 0; i < node.length; i++) {
        ret.push(visit(node[i], refsToVisit, visitedRefs));
      }
      ret.push(']');
      return ret.join(' ');
    } else if (isDict(node)) {
      var map = node.map;
      var ret = ['<<'];
      for (var key in map) {
        ret.push('/' + key + ' ' + visit(map[key], refsToVisit, visitedRefs));
      }
      ret.push('>>');
      return ret.join('\n');
    } else if (isStream(node)) {
      var ret = '';
      ret += visit(node.dict, refsToVisit, visitedRefs);
      ret += '\nstream\n';
      var bytes = node instanceof Stream ? node.getBytes() : node.bytes;
      for (var i = 0; i < bytes.length; i++) {
        ret += String.fromCharCode(bytes[i]);
      }
      ret += '\nendstream\n';
      return ret;
    } else {
      debugger;
      throw new Error('Unknown node type. ' + node);
    }
  }

  function createBody(rootRef, refManager, out) {
    var refsToVisit = [rootRef];
    var refSet = new RefSet();
    refSet.put(rootRef);
    while (refsToVisit.length) {
      var ref = refsToVisit.pop();
      var obj = refManager.get(ref);
      refManager.setOffset(ref, out.output.length);
      out.write(ref.num + ' ' + ref.gen + ' obj\n');
      out.write(visit(obj, refsToVisit, refSet));
      out.write('\nendobj\n');
    }
  }

  function createXref(refManager, out) {

    var start = out.output.length;

    out.write('xref\n');
    out.write('0 ' + 1 + '\n');
    out.write('0000000000 65535 f\r\n');
    var keys = Object.keys(refManager.offsets).sort(function (a, b) {
      return a - b;
    });
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      // TODO could make these in blocks...
      out.write(key + ' 1\r\n');
      out.write(pad(refManager.offsets[key], 10) + ' 00000 n\r\n');
    }
    return start;
  }

  function createTrailer(size, rootRef, xrefOffset, out) {
    out.write('trailer\n');
    out.write('<<\n');
    out.write('/Size ' + size + '\n');
    out.write('/Root ' + rootRef.num + ' ' + rootRef.gen + ' R' + '\n');
    out.write('>>\n');
    out.write('startxref\n');
    out.write(xrefOffset + '\n');
    out.write('%%EOF');
  }

  function newDict(map) {
    var dict = new Dict();
    dict.map = map;
    return dict;
  }

  function newStream(map, str) {
    var dict = newDict(map);
    var data = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) {
      data[i] = str.charCodeAt(i);
    }
    var stream = new Stream(data, 0, str.length, dict);
    return stream;
  }

  function create(data, fontRef, content) {
    var pdf = new PDFDocument(null, data);
    pdf.parseStartXRef();
    pdf.parse();
    var xref = pdf.xref;
    var font = xref.fetch(fontRef);
    if (!font) {
      throw new Error('Font ref was not found.' + fontRef);
    }

    var refManager = new RefManager(xref);
    var catalogRef = refManager.create();
    var pagesRef = refManager.create();
    var pageRef = refManager.create();
    var fontRef = refManager.create();
    var pageContentRef = refManager.create();

    var catalog = newDict({
      'Type':  new Name('Catalog'),
      'Pages': pagesRef.ref
    });
    catalogRef.obj = catalog;

    var pages = newDict({
      'Type': new Name('Pages'),
      'MediaBox': [0, 0, 200, 50],
      'Count': 1,
      'Kids': [pageRef.ref]
    });
    pagesRef.obj = pages;

    var page = newDict({
      'Type': new Name('Page'),
      'Parent': pagesRef.ref,
      'Resources': newDict({
        'Font': newDict({
          'F1': fontRef.ref
        })
      }),
      'Contents': pageContentRef.ref
    });
    pageRef.obj = page;

    // Fake font.
    // var font = newDict({
    //   'Type': new Name('Font'),
    //   'Subtype': new Name('Type1'),
    //   'BaseFont': new Name('Times-Roman')
    // });

    fontRef.obj = font;

    var pageContent = newStream({
        'Length': content.length
      },
      content
    );
    pageContentRef.obj = pageContent;


    var out = new PDFOut();
    createHeader(out);
    createBody(catalogRef.ref, refManager, out);
    var xrefOffset = createXref(refManager, out);
    createTrailer(refManager.offsetCount, catalogRef.ref, xrefOffset, out);

    return out.output;
  }


  return {
    create: create
  }
})();

var data = null;

window.addEventListener('change', function webViewerChange(evt) {
  var files = evt.target.files;
  if (!files || files.length === 0)
    return;

  // Read the local file into a Uint8Array.
  var fileReader = new FileReader();
  fileReader.onload = function webViewerChangeFileReaderOnload(evt) {
    var buffer = evt.target.result;
    var uint8Array = new Uint8Array(buffer);
    data = uint8Array;
  };

  var file = files[0];
  fileReader.readAsArrayBuffer(file);

}, true);

function makeLink(pdf) {
  var a = document.createElement('a');
  a.href = 'data:application/pdf;base64,' + btoa(pdf);
  a.textContent = 'download';
  return a;
}

document.addEventListener('DOMContentLoaded', function () {
  var go = document.getElementById('go');
  var ref = document.getElementById('ref');
  var text = document.getElementById('text');
  go.addEventListener('click', function () {
    if (ref.value == '' || text.value == '' || data == null) {
      alert('You\'re missing something above.');
      return;
    }
    try {
      var ops = text.value.replace(/[^\r\n]+/g, function(m) {
        return JSON.parse('"' + m + '"');
      });
      var pdf = maker.create(data, new Ref(ref.value, 0), ops);
    } catch (e) {
      alert ('Creation failed: ' + e);
      throw e;
    }
    var div = document.createElement('div');
    div.appendChild(makeLink(pdf));
    document.body.appendChild(div);
  });
});

// Debugging
// getData('/pdfs/receipt_94659.pdf', function (data) {
//   var pdf = maker.create(data, new Ref(30, 0), 'BT 10 20 TD /F1 20 Tf <0055004600540055> Tj ET ');
//   console.log(pdf);
//   document.body.appendChild(makeLink(pdf));
// });
//
