const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  FileBuilder,
  MessageFlags,
  ComponentType,
} = require('discord.js');

// One flat grey box with no side line (same look as the ticket panel).
// parts: a string or array of strings, one text block each.
// rows:  button rows shown at the bottom of the box.
// file:  name of an attached file to show inside the box.
function box(parts, { rows = [], file = null } = {}) {
  const container = new ContainerBuilder();
  const list = (Array.isArray(parts) ? parts : [parts]).filter(Boolean);

  for (const part of list) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(String(part).slice(0, 3800))
    );
  }

  if (file) {
    container.addFileComponents(new FileBuilder().setURL(`attachment://${file}`));
  }

  if (rows.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(...rows);
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

// Same box, only the person who ran it sees it.
const priv = (payload) => ({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });

// Swap the button row inside an existing ticket box (used by claim / unclaim).
function swapRow(message, newRow) {
  const old = message.components?.[0];
  if (!old) return null;

  // Tickets opened before this update still use the old layout.
  if (old.type !== ComponentType.Container) return { components: [newRow] };

  const container = new ContainerBuilder(old.toJSON());
  container.components[container.components.length - 1] = newRow;
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

module.exports = { box, priv, swapRow };
