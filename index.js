"use strict";

const css = require("css");
const cssMediaQuery = require("css-mediaquery");
const cssColorNames = require("css-color-names");
const perfectionist = require("perfectionist");
const {isShorthand} = require("css-shorthand-properties");

const defaults = {
  indentDeclaration: 2,
  indentCss: 0,
  lineLength: 80,
  ignoreSelectors: [],
  limitSpecial: 25,
  deviceType: "screen",
  deviceWidth: "1024px",
  comments: false,
  stylistic: false,
  order: "mappings",
  combine: true,
};

function mediaMatches(query, opts) {
  const {deviceType: type, deviceWidth: width} = opts;
  try {
    return cssMediaQuery.match(query, {type, width});
  } catch {
    return true; // this library has a few bugs. In case of error, we include the rule.
  }
}

function parseDeclarations(source, props, opts) {
  const decls = {};
  const stylesheet = css.parse(source.css).stylesheet;

  stylesheet.rules.forEach(rule => {
    if (rule.type === "media" && mediaMatches(rule.media, opts)) {
      rule.rules.forEach(rule => parseRule(decls, rule, props, source, opts));
    }

    const selectors = (rule.selectors || []).filter(v => !!v);
    if (selectors && selectors.length) {
      parseRule(decls, rule, props, source, opts);
    }
  });

  return decls;
}

function parseRule(decls, rule, props, source, opts) {
  for (const {value, property} of rule.declarations || []) {
    if (!props[property] || !value) continue;
    const normalizedValue = normalize(value, property);
    if (!props[property][normalizedValue]) continue;
    const originalValue = props[property][normalizedValue];

    let name = `${property}: ${originalValue}`;
    if (value.trim().endsWith("!important")) {
      name = `${name} !important`;
    }

    if (!decls[name]) decls[name] = new Set();

    for (let selector of rule.selectors) {
      // Skip ignored selectors
      if (opts.ignoreSelectors.some(re => re.test(selector))) continue;

      // stylistic tweaks
      if (opts.stylistic) {
        selector = selector
          .replace(/\+/g, " + ")
          .replace(/(~)([^=])/g, (_, m1, m2) => ` ${m1} ${m2}`)
          .replace(/>/g, " > ")
          .replace(/ {2,}/g, " ")
          .replace(/'/g, `"`)
          .replace(/([^:]):(before|after)/g, (_, m1, m2) => `${m1}::${m2}`); // css parser seems to emit "::" as ":"
      }

      // add prefix
      if (source.prefix) {
        // skip adding a prefix if it matches a selector in `match`
        let skip = false;
        if (source.match) {
          for (const match of source.match) {
            const first = selector.split(/\s+/)[0];
            if ((/^[.#]+/.test(first) && first === match) || first.startsWith(match)) {
              skip = true;
              break;
            }
          }
        }

        if (!skip) {
          // incomplete check to avoid generating invalid "html :root" selectors
          if (selector.startsWith(":root ") && source.prefix.startsWith("html")) {
            selector = `${source.prefix} ${selector.substring(":root ".length)}`;
          } else {
            selector = `${source.prefix} ${selector}`;
          }
        }
      }

      // add the selector to the selector list for this mapping
      decls[name].add(selector);
    }
  }
}

function normalizeHexColor(value) {
  if ([4, 5].includes(value.length)) {
    const [h, r, g, b, a] = value;
    return `${h}${r}${r}${g}${g}${b}${b}${a || "f"}${a || "f"}`;
  } else if (value.length === 7) {
    return `${value}ff`;
  }
  return value;
}

function normalize(value, prop) {
  value = value
    // remove !important and trim whitespace
    .replace(/!important$/g, "").trim()
    // remove leading zeroes on values like 'rgba(27,31,35,0.075)'
    .replace(/0(\.[0-9])/g, (_, val) => val)
    // normalize 'linear-gradient(-180deg, #0679fc, #0361cc 90%)' to not have whitespace in parens
    .replace(/([a-z-]+\()(.+)(\))/g, (_, m1, m2, m3) => `${m1}${m2.replace(/,\s+/g, ",")}${m3}`);

  if (value in cssColorNames) {
    value = cssColorNames[value];
  }

  if (/^#[0-9a-f]+$/i.test(value)) {
    value = normalizeHexColor(value);
  }

  // treat values case-insensitively
  if (prop !== "content" && !value.startsWith("url(")) {
    value = value.toLowerCase();
  }

  // try to ignore order in shorthands. This will only work on simple cases as for example
  // `background` can take a comma-separated list which totally breaks this comparison.
  if (isShorthand(prop)) {
    value = value.split(" ").sort().join(" ");
  }

  return value;
}

function prepareMappings(mappings, opts) {
  const newMappings = {};
  for (const [key, value] of Object.entries(mappings)) {
    if (key.startsWith("$border: ")) {
      const oldValue = key.substring("$border: ".length);
      newMappings[`border-color: ${oldValue}`] = `border-color: ${value}`;
      newMappings[`border: solid ${oldValue}`] = `border-color: ${value}`;
      newMappings[`border: dashed ${oldValue}`] = `border-color: ${value}`;
      newMappings[`border-top-color: ${oldValue}`] = `border-top-color: ${value}`;
      newMappings[`border-bottom-color: ${oldValue}`] = `border-bottom-color: ${value}`;
      newMappings[`border-left-color: ${oldValue}`] = `border-left-color: ${value}`;
      newMappings[`border-right-color: ${oldValue}`] = `border-right-color: ${value}`;
      for (let i = 1; i <= opts.limitSpecial; i++) {
        newMappings[`border: ${i}px solid ${oldValue}`] = `border-color: ${value}`;
        newMappings[`border: ${i}px dashed ${oldValue}`] = `border-color: ${value}`;
        newMappings[`border-top: ${i}px solid ${oldValue}`] = `border-top-color: ${value}`;
        newMappings[`border-top: ${i}px dashed ${oldValue}`] = `border-top-color: ${value}`;
        newMappings[`border-bottom: ${i}px solid ${oldValue}`] = `border-bottom-color: ${value}`;
        newMappings[`border-bottom: ${i}px dashed ${oldValue}`] = `border-bottom-color: ${value}`;
        newMappings[`border-left: ${i}px solid ${oldValue}`] = `border-left-color: ${value}`;
        newMappings[`border-left: ${i}px dashed ${oldValue}`] = `border-left-color: ${value}`;
        newMappings[`border-right: ${i}px solid ${oldValue}`] = `border-right-color: ${value}`;
        newMappings[`border-right: ${i}px dashed ${oldValue}`] = `border-right-color: ${value}`;
      }
    } else if (key.startsWith("$background: ")) {
      const oldValue = key.substring("$background: ".length);
      newMappings[`background: ${oldValue}`] = `background: ${value}`;
      newMappings[`background: ${oldValue} none`] = `background: ${value}`;
      newMappings[`background: none ${oldValue}`] = `background: ${value}`;
      newMappings[`background-color: ${oldValue}`] = `background-color: ${value}`;
      newMappings[`background-image: ${oldValue}`] = `background-image: ${value}`;
      newMappings[`background-image: ${oldValue} none`] = `background-image: ${value}`;
      newMappings[`background-image: none ${oldValue}`] = `background-image: ${value}`;
    } else {
      newMappings[key] = value;
    }
  }
  return newMappings;
}

// TODO: manually wrap long lines here
function format(css, opts) {
  const {indentDeclaration: indentSize, lineLength: maxSelectorLength} = opts;
  return String(perfectionist.process(css, {indentSize, maxSelectorLength}));
}

function getUnmergeables(selectors) {
  return selectors.filter(selector => /-(moz|ms|webkit)-.+/.test(selector));
}

function unmergeableRules(selectors, value, opts) {
  let ret = "";
  const moz = [];
  const webkit = [];
  const ms = [];
  const other = [];

  for (const selector of selectors) {
    if (selector.includes("-moz-")) moz.push(selector);
    else if (selector.includes("-webkit-")) webkit.push(selector);
    else if (selector.includes("-ms-")) ms.push(selector);
    else other.push(selector);
  }

  if (moz.length) ret += format(`${moz.join(", ")} {${value};}`, opts);
  if (webkit.length) ret += format(`${webkit.join(", ")} {${value};}`, opts);
  if (ms.length) ret += format(`${ms.join(", ")} {${value};}`, opts);
  if (other.length) ret += format(`${other.join(", ")} {${value};}`, opts);

  return ret;
}

function getNewValue(toValue, important) {
  if (important) {
    return toValue.trim().replace(/;$/, "").split(";").map(v => `${v} !important`).join(";");
  } else {
    return toValue.trim().replace(/;$/, "");
  }
}

function generateOutput(selectors, fromValue, newValue, opts) {
  let output = "";
  if (!selectors || !selectors.length) return output;
  const unmergeables = getUnmergeables(selectors);
  if (unmergeables.length) selectors = selectors.filter(selector => !unmergeables.includes(selector));
  if (selectors.length || unmergeables.length) output += (opts.comments ? `/* remap-css rule for "${fromValue}" */\n` : "");
  if (selectors.length) output += format(`${selectors.join(",")} {${newValue};}`, opts);
  if (unmergeables.length) output += unmergeableRules(unmergeables, newValue, opts);
  return output;
}

function buildOutput(decls, mappings, opts) {
  const sourceOrder = opts.order === "source";
  let output = opts.comments ? "/* begin remap-css rules */\n" : "";

  for (let [fromValue, toValue] of Object.entries(sourceOrder ? decls : mappings)) {
    if (sourceOrder) toValue = mappings[fromValue];

    const normalFromValue = fromValue;
    const importantFromValue = `${fromValue} !important`;

    const normalNewValue = getNewValue(toValue.trim(), false);
    const importantNewValue = getNewValue(toValue.trim(), true);

    const normalSelectors = Array.from(decls[fromValue] || []).sort();
    const importantSelectors = Array.from(decls[`${fromValue} !important`] || []).sort();

    if (opts.combine) {
      output += generateOutput(normalSelectors, normalFromValue, normalNewValue, opts);
      output += generateOutput(importantSelectors, importantFromValue, importantNewValue, opts);
    } else {
      for (const selector of normalSelectors) output += generateOutput([selector], normalFromValue, normalNewValue, opts);
      for (const selector of importantSelectors) output += generateOutput([selector], importantFromValue, normalNewValue, opts);
    }
  }
  output += (opts.comments ? "/* end remap-css rules */" : "");
  const indent = " ".repeat(opts.indentCss);
  return output.split("\n").filter(l => !!l).map(line => `${indent}${line}`).join("\n");
}

module.exports = async function remapCss(sources, mappingsArg, opts = {}) {
  opts = Object.assign({}, defaults, opts);
  const mappings = prepareMappings(mappingsArg, opts);

  const props = {};
  for (const mapping of Object.keys(mappings)) {
    const [prop, val] = mapping.split(": ");
    const normalizedVal = normalize(val, prop);
    if (!props[prop]) props[prop] = {};
    props[prop][normalizedVal] = val;
  }

  const decls = {};
  for (const source of sources) {
    for (const [key, values] of Object.entries(parseDeclarations(source, props, opts))) {
      if (!decls[key]) decls[key] = new Set();
      for (const value of values) {
        decls[key].add(value);
      }
    }
  }

  return buildOutput(decls, mappings, opts);
};
