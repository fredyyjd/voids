const { AttachmentBuilder } = require('discord.js');

/**
 * Builds a plain-text transcript of a channel's messages and returns it
 * as a Discord AttachmentBuilder ready to be sent.
 */
async function buildTranscript(channel) {
  const allMessages = [];
  let lastId;

  // Discord only returns 100 messages per call, so page backwards until done
  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    allMessages.push(...batch.values());
    lastId = batch.last().id;

    if (batch.size < 100) break;
  }

  // Messages come back newest-first, so reverse for chronological order
  allMessages.reverse();

  const lines = allMessages.map((m) => {
    const time = m.createdAt.toISOString().replace('T', ' ').slice(0, 19);
    const author = `${m.author.tag} (${m.author.id})`;
    let content = m.content || '';

    if (m.embeds.length > 0) {
      content += ` [${m.embeds.length} embed(s)]`;
    }
    if (m.attachments.size > 0) {
      const files = [...m.attachments.values()].map((a) => a.url).join(', ');
      content += ` [attachments: ${files}]`;
    }

    return `[${time}] ${author}: ${content}`;
  });

  const header = `Transcript for #${channel.name} (${channel.id})\nGenerated: ${new Date().toISOString()}\n${'='.repeat(60)}\n\n`;
  const body = lines.length > 0 ? lines.join('\n') : '(no messages)';

  const buffer = Buffer.from(header + body, 'utf-8');
  return new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.txt` });
}

module.exports = { buildTranscript };
