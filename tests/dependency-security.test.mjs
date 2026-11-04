import test from 'node:test';
import assert from 'node:assert/strict';
import sanitizeHtml from 'sanitize-html';
import katex from 'katex';

test('HTML sanitization removes script URLs hidden in zero-padded numeric references', () => {
  for (const href of ['&#000000106;avascript:alert(1)', '&#0000106;&#0000097;vascript:alert(1)']) {
    const html=sanitizeHtml(`<a href="${href}">link</a>`);
    assert.equal(html,'<a>link</a>');
  }
  assert.equal(sanitizeHtml('<a href="https://example.com">safe</a>'),'<a href="https://example.com">safe</a>');
});

test('math rendering cannot enable script links through an inherited trust setting', () => {
  const options=Object.assign(Object.create({trust:true}),{throwOnError:false,strict:'ignore'});
  const html=katex.renderToString('\\href{javascript:alert(1)}{unsafe}',options);
  assert.doesNotMatch(html,/<a\b[^>]*href=/i);
  assert.match(katex.renderToString('x^2',{throwOnError:false}),/katex/);
});
