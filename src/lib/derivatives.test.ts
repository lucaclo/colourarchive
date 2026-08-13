import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { auditPhotos, auditClean, describeAudit, expectedTags, tagOf } from './derivatives.ts';
import type { Photo } from './types.ts';

/** A store entry with only the fields the audit reads. */
const entry = (
  id: string,
  width: number,
  derivatives: Array<{ width: number; avif: string; webp?: string }>,
): Photo =>
  ({ id, filename: `${id}.jpg`, width, derivatives } as unknown as Photo);

/** The derivatives ingest would have written for a source this wide. */
const generated = (id: string, width: number) =>
  expectedTags(width).map((tag) => ({
    width: tag === 'full' ? width : tag,
    avif: `/img/${id}-${tag}.avif`,
  }));

const filesFor = (id: string, width: number) =>
  generated(id, width).map((d) => d.avif.replace('/img/', ''));

describe('expectedTags', () => {
  it('never asks for a width the source cannot fill', () => {
    assert.deepEqual(expectedTags(4341), [640, 1280, 2000]);
    assert.deepEqual(expectedTags(1500), [640, 1280]);
    assert.deepEqual(expectedTags(700), [640]);
  });

  it('asks for one native-size file when the source is narrower than the narrowest width', () => {
    assert.deepEqual(expectedTags(480), ['full']);
  });

  it('asks for the full set when the width could not be read, because that is what ingest emits', () => {
    assert.deepEqual(expectedTags(0), [640, 1280, 2000]);
  });
});

describe('tagOf', () => {
  it('reads the width back off a derivative filename', () => {
    assert.equal(tagOf('d62b2154e7fee842-2000.avif'), 2000);
    assert.equal(tagOf('d62b2154e7fee842-full.avif'), 'full');
  });

  it('refuses anything that is not one of ours', () => {
    assert.equal(tagOf('.gitkeep'), null);
    assert.equal(tagOf('holiday.jpg'), null);
    assert.equal(tagOf('d62b2154e7fee842.avif'), null);
  });
});

describe('auditPhotos', () => {
  it('says nothing when every entry has its files and every file its entry', () => {
    const audit = auditPhotos([entry('aaaa', 4000, generated('aaaa', 4000))], filesFor('aaaa', 4000));
    assert.ok(auditClean(audit), describeAudit(audit).join('\n'));
    assert.equal(audit.entries, 1);
    assert.equal(audit.files, 3);
  });

  it('names the derivative a page would request and 404 on', () => {
    const audit = auditPhotos(
      [entry('aaaa', 4000, generated('aaaa', 4000))],
      ['aaaa-640.avif', 'aaaa-1280.avif'],
    );
    assert.deepEqual(
      audit.missing.map((m) => m.file),
      ['aaaa-2000.avif'],
    );
    assert.equal(audit.missing[0].width, 2000);
    assert.equal(audit.missing[0].format, 'avif');
  });

  it('reports a photograph with no derivatives on disk at all, rather than one file', () => {
    const audit = auditPhotos([entry('aaaa', 4341, generated('aaaa', 4341))], []);
    assert.equal(audit.missing.length, 3);
    assert.equal(audit.undeclared.length, 0); // it declares them; it just has none
  });

  it('counts a legacy webp declaration as missing, since anything reading it would 404', () => {
    const photo = entry('aaaa', 4000, [
      { width: 640, avif: '/img/aaaa-640.avif', webp: '/img/aaaa-640.webp' },
      { width: 1280, avif: '/img/aaaa-1280.avif' },
      { width: 2000, avif: '/img/aaaa-2000.avif' },
    ]);
    const audit = auditPhotos([photo], filesFor('aaaa', 4000));
    assert.deepEqual(
      audit.missing.map((m) => [m.file, m.format]),
      [['aaaa-640.webp', 'webp']],
    );
    // The width is still covered — the avif beside it is there.
    assert.equal(audit.undeclared.length, 0);
  });

  it('does not double-report: a declared width whose file is absent is missing, not undeclared', () => {
    const audit = auditPhotos([entry('aaaa', 4000, generated('aaaa', 4000))], []);
    assert.equal(audit.undeclared.length, 0);
    assert.equal(audit.missing.length, 3);
  });

  it('reports a width the source is large enough for that nothing declares', () => {
    const audit = auditPhotos(
      [entry('aaaa', 4000, generated('aaaa', 1500))],
      filesFor('aaaa', 1500),
    );
    assert.deepEqual(audit.undeclared, [{ id: 'aaaa', filename: 'aaaa.jpg', tag: 2000 }]);
    assert.equal(audit.missing.length, 0);
  });

  it('does not call a narrow photograph short of the widths it could never fill', () => {
    const audit = auditPhotos([entry('aaaa', 900, generated('aaaa', 900))], filesFor('aaaa', 900));
    assert.ok(auditClean(audit), describeAudit(audit).join('\n'));
  });

  it('reports files that outlived the entry that owned them', () => {
    const audit = auditPhotos(
      [entry('aaaa', 4000, generated('aaaa', 4000))],
      [...filesFor('aaaa', 4000), 'bbbb-640.avif', 'bbbb-1280.avif'],
    );
    assert.deepEqual(audit.orphans, ['bbbb-1280.avif', 'bbbb-640.avif']);
    assert.equal(audit.missing.length, 0);
  });

  it('leaves dotfiles alone — .gitkeep is how the directory survives a clone', () => {
    const audit = auditPhotos(
      [entry('aaaa', 4000, generated('aaaa', 4000))],
      ['.gitkeep', '.DS_Store', ...filesFor('aaaa', 4000)],
    );
    assert.ok(auditClean(audit), describeAudit(audit).join('\n'));
    assert.equal(audit.files, 3);
  });

  it('keeps a file owned while any entry still declares it, even when two do', () => {
    const shared = [{ width: 640, avif: '/img/aaaa-640.avif' }];
    const audit = auditPhotos(
      [entry('aaaa', 700, shared), entry('bbbb', 700, shared)],
      ['aaaa-640.avif'],
    );
    assert.equal(audit.orphans.length, 0);
    assert.equal(audit.missing.length, 0);
  });
});

describe('describeAudit', () => {
  it('names the photograph, not just the hash, so the line can be acted on', () => {
    const audit = auditPhotos([entry('aaaa', 4341, generated('aaaa', 4341))], []);
    const text = describeAudit(audit).join('\n');
    assert.match(text, /aaaa\.jpg/);
    assert.match(text, /aaaa-2000\.avif {2}\(2000w avif\)/);
  });

  it('says so plainly when there is nothing to report', () => {
    const audit = auditPhotos([], []);
    assert.match(describeAudit(audit).join('\n'), /Every entry has its files/);
  });
});
