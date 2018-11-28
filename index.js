'use strict';

const css = require('css');
const fs = require('fs-extra'),
      path = require('path'),
      entities = require('entities'),
      url = require('url'),
      htmlBeautify = require("js-beautify").html,
      specificity = require('css-specificity');

require('sugar')();

// var util = require('util');

var osmosis = require('osmosis');

module.exports = function (opts) {
  console.log(opts);

  if (!opts.pages) {
    opts.pages = [];
  }

  opts.pages.push('/');

  opts.pages = opts.pages.unique();

  if (!opts.contextAttr) {
    opts.contextAttr = 'class';
  }

  if (!opts.hasOwnProperty('selectorPrefix')) {
    opts.selectorPrefix = 'w-root';
  }

  var style_contexts = {};

  var globalStyles = '';

  var globalData = null;

  osmosis.get(url.resolve(opts.url, opts.pages.shift())).set({
    'favicon': osmosis.find('link[rel="shortcut icon"]:first').config({ parse: false }).get(function (context) {
      return context.getAttribute('href');
    }).then(function (context, data, next) {
      next(context, context.toString('base64'));
    }),
    'styles': osmosis.find('link[rel="stylesheet"]:first').config({ parse: false }).get(function (context) {
      return context.getAttribute('href');
    }).then(function (context, data, next) {
      next(context, context.toString());
    }),
    'head_scripts': osmosis.find('head script').then(function (context, data, next) {
      if (/use\.typekit/i.test(context.getAttribute('src'))) {
        context.remove();
      }

      next(context, context.toString());
    }),
    'script': osmosis.find('script[src^="https://uploads-ssl.webflow.com"]').config({ parse: false }).get(function (context) {
      return context.getAttribute('src');
    }).then(function (context, data, next) {
      next(context, context.toString());
    }),
  })
  .then(function (context, data) {
    globalStyles = css.parse(data.styles);
  })
  .config('ignore_http_errors', true)
  .paginate(function () {
    return opts.pages.shift();
  }, opts.pages.length)
  .then(function (document) {
    document.get('[src="https://code.jquery.com/jquery-3.3.1.min.js"]').setAttribute('src', 'https://code.jquery.com/jquery-3.3.1.js');
  })
  .set({
    // 'fields': ['@data-field'],
    'elements': [osmosis.find(opts.includeBody ? '[' + opts.contextAttr + ']' : 'body [' + opts.contextAttr + ']').then(function (node, data, next) {
      data.keys = node.find('ancestor::*[' + opts.contextAttr + ']').filter(function (n) {
        if (!opts.includeBody) {
          return n.nodeName.toLowerCase() != 'body';
        }

        return true;
      }).map(function (n) {
        return n.getAttribute(opts.contextAttr).split(/\s+/);
      });

      data.keys.push(node.getAttribute(opts.contextAttr).split(/\s+/));

      data.context = data.class = data.keys.map(function (keys) {
        return '.' + keys.join('.');
      }).join(' ');

      // data.html = node.toString(true);
      data.node = node;
      next(node, data);
    })],
  })
  .click('body')
  .then(function (document, data, next) {
    var window = document.defaultView,
        $ = window.jQuery;

    if (opts.preprocess instanceof Function) {
      opts.preprocess(document, $, data);
    }

    $('span[aria-hidden="true"]').remove();

    $('.webflow-page-label').remove();

    if (opts.jquery !== true) {
      $('body script[src*="jquery"]').remove();
    }

    $('body script').remove();

    if (!data.elements) {
      data.elements = [];
    }

    $('body').each(function () {
      var script1 = document.createElement('script');

      script1.innerHTML = ('document.documentElement.setAttribute("data-wf-site", ' + JSON.stringify($(this).parents('[data-wf-site]').data('wf-site')) + ');');

      var script2 = document.createElement('script');

      script2.innerHTML = ('document.documentElement.setAttribute("data-wf-page", ' + JSON.stringify($(this).parents('[data-wf-page]').data('wf-page')) + ');');
      // var text = document.createTextNode(
      //   '<script>document.documentElement.setAttribute("data-wf-page", ' + JSON.stringify($(this).parents('[data-wf-page]').data('wf-page')) + ');</script>' +
      //   '<script></script>'
      //   );

      // if (c.node.parentNode) {
      //   c.node.parentNode.addChild(text);
      // } else {
      this.addChild(script1);
      this.addChild(script2);

      // console.log(this.innerHTML);
      // process.exit();
    });

    if (!data.elements) {
      data.elements = [data.elements].compact();
    }

    data.elements.forEach(function (c) {
      var loopAttr = (c.node.getAttribute('v-for') || c.node.getAttribute('foreach') || '').replace(/\\*"/g, '\'');

      if (loopAttr) {

        var children = [];

        c.node.children.forEach(function (child, index, arr) {
          if (child.nodeName) {
            children.push(child);
          }
        });

        var classes = children.map((c) => c.getAttribute('class')).compact(true).unique(),
            conditions = children.map((c) => c.getAttribute('if') || c.getAttribute('v-if')).compact(true);

        c.node.children[0].addPrevSibling(document.createTextNode('{% set item=\'\' %}{% for ' + loopAttr + ' %}' +
          '{% if loop_context(loop, _key, _seq) %}{% set item = _seq[loop.index0] %}{% endif %}'));
        c.node.children[c.node.children.length - 1].addNextSibling(document.createTextNode('{% endfor %}'));

        if (children.length > 0 && conditions.length < 1) {
          children.forEach(function (child, index, arr) {
            child.setAttribute('v-if', 'loop.index0 % ' + arr.length + ' == ' + index + '');
          });
        }
      }
    });

    var rules = globalStyles.stylesheet.rules.filter({type:'media'}).map(function (v) {
      if (!v.rules) {
        return null;
      }

      if (!Array.isArray(v.rules)) {
        v.rules = [v.rules];
      }

      v.rules.forEach(function (r) {
        r.mediaParent = v;
      });

      return v.rules;
    });

    rules.push(globalStyles.stylesheet.rules);

    rules.forEach(function (rules, ruleIndex) {
      if (!rules) {
        return;
      }

      rules.forEach(function (rule) {
        if (!rule.selectors || !rule.declarations) {
          return;
        }

        rule.selectors.clone().forEach(function (selector, index) {
          var stateString = '',
              searchSelector = selector;

          ['active', 'hover', 'visited', 'target', 'focus'].forEach(function (state) {
            var regexp = new RegExp(':' + state, 'g');

            if (regexp.test(selector)) {
              stateString = ':' + state;

              searchSelector = searchSelector.replace(regexp, '');

              rule.selectors.push(selector.replace(regexp, '.w-' + state));
            }
          });

          if (/-webkit|-moz/.test(selector)) {
            return;
          }

          if (!selector) {
            rules.remove(rule);
            return;
          }

          try {
            var nodes = document.find(searchSelector);
          } catch (e) {
            // console.error(e);
          }

          if (!nodes) {
            return;
          }

          rule.declarations.forEach(function (d, i) {
            if (d.property == 'background-image' && d.value.indexOf('url(') !== -1) {
              nodes.forEach(function (n) {
                var url = n.getAttribute('data-background-image');

                if (!url) {
                  return;
                }

                n.setAttribute('style', [n.getAttribute('style'), 'background-image: ' + d.value.replace(/url\(".+?"\)/g, 'url(\'' + url + '\')')].compact(true).join(';'));
              });
            }
          });

          if (/^(\.w-|[^\.])/.test(selector)) {
            return;
          }

          nodes.filter(function (node) {
            return node.getAttribute('style-context');
          }).forEach(function (node) {
            var style_context = [node.getAttribute('style-context')],
                parent = node, last_had_style_context = true;

            while (parent.parent && (parent = parent.parent())) {
              if (parent.getAttribute && parent.getAttribute('style-context')) {
                if (!opts.directChildTargeting) {
                  last_had_style_context = false;
                }

                if (last_had_style_context) {
                  style_context.push('>');
                } else {
                  last_had_style_context = true;
                }

                style_context.push(parent.getAttribute('style-context'));
              } else {
                last_had_style_context = false;
              }
            }

            style_context = style_context.compact(true).reverse().join(' ').trim().replace(/^[>~\+]+/, '') + stateString;
            
            if (rule.selectors.indexOf(style_context) === -1) {
              console.log('\n');
              console.log('Adding selector ' + JSON.stringify(style_context) + ' to \n' + selector + ' {');
              console.log(rule.declarations.map(function (d) {
                return '\t' + [d.property, d.value].join(': ');
              }).join('\n'));
              console.log('}\n');
            }

            if (style_context) {
              if (!style_contexts[style_context]) {
                style_contexts[style_context] = [];
              }

              var rule_clone = Object.clone(rule);

              rule_clone.selector = style_context;

              style_contexts[style_context].push(rule_clone);
            }
          });
        });
      });
    });

    // console.log(data.styles);

    // process.exit();

    document.find('[if], [v-if]').forEach(function (node) {
      var condition = node.getAttribute('v-if');

      node.addPrevSibling(document.createTextNode('{% if ' + condition + ' %}'));
      node.addNextSibling(document.createTextNode('{% endif %}'));

      node.removeAttribute('v-if');
      node.removeAttribute('if');
    });

    document.find('[php-content]').forEach(function (node) {
      var value = node.getAttribute('php-content');

      $(node.children).remove();

      // node.innerHTML = '<?php ' + value + ' ?>';

      node.addChild(document.createTextNode('<?php ' + value + ' ?>'));

      node.setAttribute('php-content', '');
      node.removeAttribute('php-content');
    });


    data.elements.forEach(function (el) {
      $(el.node).find('[php-block], [php-outer-block]').toArray().forEach(function (node) {
        var condition = node.getAttribute('php-block');

        node.addPrevSibling(document.createTextNode('<?php ' + condition + ' { ?>'));
        node.addNextSibling(document.createTextNode('<?php } ?>'));

        node.setAttribute('php-block', '');
        node.removeAttribute('php-block');
      });

      $(el.node).find('[php-inner-block]').toArray().forEach(function (node) {
        var value = node.getAttribute('php-inner-block');

        node.addChild(document.createTextNode('<?php } ?>'));
        node.children[0].addPrevSibling(document.createTextNode('<?php ' + value + ' { ?>'));

        node.setAttribute('php-inner-block', '');
        node.removeAttribute('php-inner-block');
      });

      $(el.node).find('[php-exclude]').toArray().forEach(function (node) {
        node.children.forEach(function (c) {
          c.remove();
          node.addPrevSibling(c);
        });

        node.remove();
      });
    });

    document.find('[replace]').forEach(function (node) {
      var value = node.getAttribute('replace');

      $(node.children).remove();

      node.innerHTML = '{{ ' + value + ' }}';
      // node.addChild(document.createTextNode('{{ ' + value + ' }}'));

      node.removeAttribute('replace');
    });

    $('[data-exclude]').remove();

    data.elements.forEach(function (c) {
      var text = document.createTextNode('{{ webflow_render(' + JSON.stringify(c.node.getAttribute(opts.contextAttr).split(/\s+/)).replace(/"/g, '\'') + ', _context) }}');

      // if (c.node.parentNode) {
      //   c.node.parentNode.addChild(text);
      // } else {
        c.node.addNextSibling(text);
      // }

      c.node.remove();

      $(c.node).find('[data-exclude]').remove();
    });




    data.elements.forEach(function (c) {
      if (c.node.nodeName.toLowerCase() === 'body') {
        c.html = c.node.innerHTML;
      } else {
        c.html = c.node.toString();
      }

      c.html = c.html.replace(/(https?:\/\/)?%7B%7B(%20)*/g, '{{ ').replace(/(%20)*%7D%7D/g, ' }}')
            .replace(/\{\{\s+/g, '{{')
            .replace(/\s+\}\}/g, '}}')
            .replace(/&amp;lt;\?php\s.+?\s\?&amp;gt;\s*($|<)/g, function (str) {
              return entities.decodeHTML(entities.decodeHTML(str));
            })
            .replace(/&lt;\?php.+?\?&gt;/g, function (str) {
              return decodeURIComponent(entities.decodeHTML(str));
            });


      if (opts.processHTML instanceof Function) {
        c.html = opts.processHTML(c.html, c);
      }

      c.html = htmlBeautify(c.html);
      // console.log(c.html);
      // delete c.node;
    });

    delete data.node;

    next(document, data);
  })
  .data(function (data) {
    if (!globalData) {
      globalData = data;
    }

    globalData.elements.append(data.elements);
  })
  .done(function () {
    Object.keys(style_contexts).forEach(function (context_selector) {
      (style_contexts[context_selector] = style_contexts[context_selector].filter(function (rule) {
        var declarations = mapDeclarations(rule.declarations);

        var has_duplicate = Object.values(style_contexts).flatten().some(function (target_rule) {
          if (!target_rule.selector) {
            return false;
          }

          if (target_rule.selector === rule.selector) {
            return false;
          }

          return (rule.selector.startsWith(target_rule.selector) && declarations === mapDeclarations(target_rule.declarations));
        });

        return !has_duplicate;
      }).unique(function (rule) {
        return [rule.mediaParent ? rule.mediaParent.media : '', rule.selectors.join(', '), mapDeclarations(rule.declarations)].join(' ');
      }).sortBy(function (rule) {
        return rule.selectors.max(function (selector) {
          return specificity.calc(selector).map('specificity').flatten().sum();
        }) + (rule.mediaParent ? 10 : 0);
      })).forEach(function (rule) {
        // if (!Array.isArray(stylesheet.rules)) {
        //   stylesheet.rules = [stylesheet.rules].compact();
        // }

        rule.selectors = [context_selector];

        if (rule.mediaParent) {
          var mediaParent = Object.clone(rule.mediaParent);

          mediaParent.rules = [ rule ];

          rule = mediaParent;
        }

        globalStyles.stylesheet.rules.push(rule);
      });
    });

    var rules = globalStyles.stylesheet.rules.filter({type:'media'}).map(function (v) {
      if (!v.rules) {
        return null;
      }

      if (!Array.isArray(v.rules)) {
        v.rules = [v.rules];
      }

      return v.rules;
    });

    rules.push(globalStyles.stylesheet.rules);

    if (opts.selectorPrefix) {
      var selectorPrefixRegex = new RegExp('\\.' + opts.selectorPrefix + '\\b');

      rules.forEach(function (rules, ruleIndex) {
        if (!rules) {
          return;
        }

        rules.forEach(function (rule) {
          if (!rule.selectors || !rule.declarations) {
            return;
          }

          rule.selectors.forEach(function (selector, i) {
            if (!selectorPrefixRegex.test(selector)) {
              rule.selectors[i] = '.' + opts.selectorPrefix + ' ' + selector;
            }
          });
        });
      });
    }

    rules.forEach(function (rules, ruleIndex) {
      if (!rules) {
        return;
      }

      rules.forEach(function (rule) {
        delete rule.mediaParent;

        if (!rule.selectors || !rule.declarations) {
          return;
        }

        rule.selectors = rule.selectors.unique();
      });
    });

    globalData.styles = css.stringify(globalStyles);

    var data = globalData;

    console.log('\n\nTemplated '  + data.elements.length);

    if (typeof opts.json === 'string') {
      fs.writeJsonSync(path.resolve(opts.base, opts.json), data.elements);
    }

    // .replace(/url\(([^\)]*)\)/g, 'attr(data-background-image url, $1)') not yet supported

    if (typeof opts.css === 'string') {
      fs.outputFileSync(path.resolve(opts.base, opts.css), data.styles);
    }

    if (typeof opts.js === 'string') {
      fs.outputFileSync(path.resolve(opts.base, opts.js), data.script);
    }

    if (opts.callback instanceof Function) {
      opts.callback(data);
    }
  })
  .log(console.error)
  .error(console.error);
}

function mapDeclarations(declarations) {
  return declarations.map(function (d) {
                  return '\t' + [d.property, d.value].join(': ');
                }).join('\n');
}