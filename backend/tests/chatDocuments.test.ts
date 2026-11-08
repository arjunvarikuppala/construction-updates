/**
 * Project chat document sharing & reply-to-message:
 * MD sends a PDF → In-Charge previews and replies → MD sees the linked reply;
 * In-Charge shares an existing expense receipt → MD replies to it;
 * plus company/project/revocation isolation for every attachment path.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer,
  stopTestServer,
  api,
  rawGet,
  registerMD,
  createProject,
  assignNewInCharge,
  tinyPng,
} from './helpers.js';

let mdA: { token: string; userId: string };
let mdB: { token: string; userId: string };
let projectA: any;
let projectA2: any;
let projectB: any;
let icA: { token: string; userId: string };

function pdfBlob(): Blob {
  const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
  return new Blob([Buffer.from(pdf)], { type: 'application/pdf' });
}

async function uploadToChat(token: string, projectId: string, blob: Blob, name: string) {
  const form = new FormData();
  form.append('files', blob, name);
  return api('POST', `/api/v1/projects/${projectId}/messages/upload`, { token, form });
}

const msgs = (token: string, projectId: string) => api('GET', `/api/v1/projects/${projectId}/messages`, { token });
const send = (token: string, projectId: string, body: any) =>
  api('POST', `/api/v1/projects/${projectId}/messages`, { token, body });

before(async () => {
  await startTestServer();
  mdA = await registerMD('ChatMD');
  mdB = await registerMD('OtherCoMD');
  projectA = await createProject(mdA.token, 'ChatA');
  projectA2 = await createProject(mdA.token, 'ChatA2');
  projectB = await createProject(mdB.token, 'ChatB');
  icA = await assignNewInCharge(mdA.token, projectA._id, 'Kiran');
});

after(async () => {
  await stopTestServer();
});

describe('document sharing and replies', () => {
  let pdfAttachment: any;
  let pdfMessageId: string;

  test('MD uploads and sends a PDF', async () => {
    const up = await uploadToChat(mdA.token, projectA._id, pdfBlob(), 'Quotation-March.pdf');
    assert.equal(up.status, 200, JSON.stringify(up.body));
    pdfAttachment = up.body.attachments[0];
    assert.equal(pdfAttachment.type, 'document');
    assert.equal(pdfAttachment.mimeType, 'application/pdf');
    assert.equal(pdfAttachment.name, 'Quotation-March.pdf');

    const r = await send(mdA.token, projectA._id, { content: 'Please check the quotation', attachments: [pdfAttachment] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.messageType, 'MIXED');
    pdfMessageId = r.body.data._id;
  });

  test('In-Charge sees the PDF after refresh and can preview it', async () => {
    const list = await msgs(icA.token, projectA._id);
    assert.equal(list.status, 200);
    const m = list.body.messages.find((x: any) => x._id === pdfMessageId);
    assert.ok(m, 'message persisted');
    assert.equal(m.attachments[0].name, 'Quotation-March.pdf');

    const signed = await api('POST', '/api/v1/files/sign', { token: icA.token, body: { urls: [pdfAttachment.url] } });
    const link = signed.body.signed[pdfAttachment.url];
    assert.ok(link, 'assigned in-charge gets a signed link');
    const file = await rawGet(link);
    assert.equal(file.status, 200);
    assert.match(String(file.headers.get('content-type')), /pdf/);

    const media = await api('GET', pdfAttachment.url, { token: icA.token });
    assert.equal(media.status, 200);
    assert.match(String(media.headers.get('content-disposition')), /^inline/);
  });

  test('In-Charge replies to the PDF and MD sees the linked reply', async () => {
    const r = await send(icA.token, projectA._id, { content: 'Rates look fine', replyToMessageId: pdfMessageId });
    assert.equal(r.status, 201, JSON.stringify(r.body));

    const list = await msgs(mdA.token, projectA._id);
    const reply = list.body.messages.find((x: any) => x._id === r.body.data._id);
    assert.equal(reply.replyTo._id, pdfMessageId);
    assert.equal(reply.replyTo.attachments[0].name, 'Quotation-March.pdf');
    assert.ok(reply.replyTo.sender.name);
  });

  test('In-Charge shares an existing expense receipt by reference; MD replies to it', async () => {
    const form = new FormData();
    form.append('file', tinyPng(), 'bill.png');
    const up = await api('POST', '/api/v1/uploads/single', { token: icA.token, form });
    assert.equal(up.status, 200);
    const exp = await api('POST', '/api/v1/expenses', {
      token: icA.token,
      body: {
        project: projectA._id,
        date: new Date().toISOString(),
        category: 'CONSTRUCTION_MATERIALS',
        description: 'Steel rods',
        vendor: 'Sai Steels',
        amount: 1200,
        receiptUrl: up.body.fileUrl,
      },
    });
    assert.equal(exp.status, 201, JSON.stringify(exp.body));

    const shareable = await api('GET', `/api/v1/projects/${projectA._id}/messages/shareable`, { token: icA.token });
    assert.equal(shareable.status, 200);
    const receipt = shareable.body.files.find((f: any) => f.url === up.body.fileUrl);
    assert.ok(receipt, 'receipt listed as shareable');

    const shared = await send(icA.token, projectA._id, { attachments: [{ url: receipt.url, name: receipt.name }] });
    assert.equal(shared.status, 201, JSON.stringify(shared.body));
    assert.equal(shared.body.data.attachments[0].url, up.body.fileUrl, 'same file, not duplicated');
    assert.equal(shared.body.data.attachments[0].type, 'image');

    // MD did not upload it but can share it again: it belongs to this project
    const reply = await send(mdA.token, projectA._id, {
      content: 'Approved, pay the vendor',
      replyToMessageId: shared.body.data._id,
    });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.data.replyTo._id, shared.body.data._id);
  });

  test('retrying with the same clientMessageId does not duplicate the message', async () => {
    const body = { content: 'Network flaky', clientMessageId: 'retry-key-12345' };
    const first = await send(mdA.token, projectA._id, body);
    const second = await send(mdA.token, projectA._id, body);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.data._id, first.body.data._id);
    const list = await msgs(mdA.token, projectA._id);
    assert.equal(list.body.messages.filter((m: any) => m.content === 'Network flaky').length, 1);
  });

  test('a file disguised as PDF is rejected by content inspection', async () => {
    const fake = new Blob([Buffer.from('<html><script>alert(1)</script></html>')], { type: 'application/pdf' });
    const up = await uploadToChat(mdA.token, projectA._id, fake, 'invoice.pdf');
    assert.equal(up.status, 400);
  });

  describe('authorization', () => {
    test('other company MD cannot read messages, sign or stream the PDF', async () => {
      assert.equal((await msgs(mdB.token, projectA._id)).status, 403);
      const signed = await api('POST', '/api/v1/files/sign', { token: mdB.token, body: { urls: [pdfAttachment.url] } });
      assert.equal(signed.body.signed[pdfAttachment.url], null);
      const viaOwnProject = pdfAttachment.url.replace(String(projectA._id), String(projectB._id));
      assert.equal((await api('GET', viaOwnProject, { token: mdB.token })).status, 403);
      assert.equal((await api('GET', pdfAttachment.url, { token: mdB.token })).status, 403);
    });

    test("a project file cannot be smuggled into another project's chat", async () => {
      const intoB = await send(mdB.token, projectB._id, { attachments: [pdfAttachment] });
      assert.equal(intoB.status, 400);
      // Same company, different project: still refused (the in-charge is not on it)
      const intoA2 = await send(mdA.token, projectA2._id, { attachments: [pdfAttachment] });
      assert.equal(intoA2.status, 400);
    });

    test('forged attachment URLs are refused', async () => {
      for (const url of ['javascript:alert(1)', '/uploads/../../etc/passwd', 'http://evil.test/x.pdf', '/uploads/not-mine.pdf']) {
        const r = await send(mdA.token, projectA._id, { attachments: [{ url, name: 'x.pdf' }] });
        assert.equal(r.status, 400, url);
      }
    });

    test('cannot reply to a message from another project', async () => {
      const other = await send(mdA.token, projectA2._id, { content: 'other project' });
      const r = await send(mdA.token, projectA._id, { content: 'x', replyToMessageId: other.body.data._id });
      assert.equal(r.status, 400);
      const bad = await send(mdA.token, projectA._id, { content: 'x', replyToMessageId: 'not-an-id' });
      assert.equal(bad.status, 400);
    });

    test('revoked in-charge loses access to chat and attachments', async () => {
      const ic = await assignNewInCharge(mdA.token, projectA._id, 'Revoked');
      const before = await api('POST', '/api/v1/files/sign', { token: ic.token, body: { urls: [pdfAttachment.url] } });
      assert.ok(before.body.signed[pdfAttachment.url]);

      const rev = await api('DELETE', `/api/v1/projects/${projectA._id}/assignments/${ic.userId}`, { token: mdA.token });
      assert.equal(rev.status, 200);

      assert.equal((await msgs(ic.token, projectA._id)).status, 403);
      const after = await api('POST', '/api/v1/files/sign', { token: ic.token, body: { urls: [pdfAttachment.url] } });
      assert.equal(after.body.signed[pdfAttachment.url], null);
      assert.equal((await api('GET', pdfAttachment.url, { token: ic.token })).status, 403);
      assert.equal((await api('GET', `/api/v1/projects/${projectA._id}/messages/shareable`, { token: ic.token })).status, 403);
      assert.equal((await send(ic.token, projectA._id, { content: 'still here?' })).status, 403);
    });
  });
});
