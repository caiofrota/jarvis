const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldSpeakChatResponse } = require('../dist/shared/chat-speech-policy.js');

test('chat only sends completed responses to speech synthesis', () => {
  assert.equal(shouldSpeakChatResponse(true, 'done'), true);
  assert.equal(shouldSpeakChatResponse(true, 'error'), false);
  assert.equal(shouldSpeakChatResponse(true, 'cancelled'), false);
  assert.equal(shouldSpeakChatResponse(false, 'done'), false);
});
