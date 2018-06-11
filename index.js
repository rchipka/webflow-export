'use strict';

const fs = require('fs-extra'),
      path = require('path');

require('sugar')();

var osmosis = require('osmosis');

module.exports = function (opts) {
  console.log(opts);

  var partsDir = path.resolve(opts.base, opts.json);
  var cssDir = path.resolve(opts.base, opts.css);

  // fs.ensureDir(partsDir);

  osmosis.get(opts.url).set({
    'styles': osmosis.find('link[rel="stylesheet"]:first').config({ parse: false }).get(function (context) {
      return context.getAttribute('href');
    }).then(function (context, data, next) {
      next(context, context.toString());
    }),
    'fields': ['@data-field'],
    'elements': osmosis.find('body [class]').then(function (node, data, next) {
      data.keys = node.find('ancestor::*[class]').filter(function (n) {
        return n.nodeName.toLowerCase() != 'body';
      }).map(function (n) {
        return n.getAttribute('class').split(/\s+/);
      });

      data.keys.push(node.getAttribute('class').split(/\s+/));

      data.class = data.keys.map(function (keys) {
        return '.' + keys.join('.');
      }).join(' ');

      // data.html = node.toString(true);
      data.node = node;
      next(node, data);
    }),
  })
  .then(function (document) {
    document.get('[src="https://code.jquery.com/jquery-3.3.1.min.js"]').setAttribute('src', 'https://code.jquery.com/jquery-3.3.1.js');
  })
  .click('body')
  .then(function (document, data) {
    var window = document.defaultView,
        $ = window.jQuery;

    $('.webflow-page-label').remove();

    data.elements.forEach(function (c) {
      c.node.addNextSibling($('<div>{{ webflow_render(' + JSON.stringify(c.node.getAttribute('class').split(/\s+/)) + ') }}</div>')[0]);
      var loopAttr = c.node.getAttribute('v-for') || c.node.getAttribute('foreach');

      if (loopAttr && c.node.children.length > 0) {
        c.node.children[0].addPrevSibling(document.createTextNode('{% for ' + loopAttr + ' %}'));
        c.node.children[c.node.children.length - 1].addNextSibling(document.createTextNode('{% endfor %}'));

        var total = 0;

        c.node.children.forEach(function (child, index, arr) {
          if (child.nodeName) {
            total++;
          }
        });

        var index = 0;

        c.node.children.forEach(function (child) {
          if (child.addPrevSibling) {
            child.addPrevSibling(document.createTextNode('{% if loop.index0 % ' + total + ' == ' + (index++) + ' %}'));
            child.addNextSibling(document.createTextNode('{% endif %}'));
          }
        });
      }
    });

    data.elements.forEach(function (c) {
      $(c.node).remove();
    });

    data.elements.forEach(function (c) {
      c.html = c.node.toString(true);
      // console.log(c.html);
    });

    delete data.node;
  })
  .data(function (data) {
    console.log(data.elements);

    fs.writeJsonSync(path.resolve(opts.base, opts.json), data.elements);

    fs.outputFileSync(path.resolve(opts.base, opts.css), data.styles);
  })
  .log(console.error)
  .error(console.error);

}