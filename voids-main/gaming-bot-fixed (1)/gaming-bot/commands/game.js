const { SlashCommandBuilder } = require('discord.js');
const g = require('../utils/games');

const GAMES = [
  ['last-typer', 'Keep sending messages. Miss the timer and you are out', g.lastTyper],
  ['closest', 'Guess a number from 1 to 1000. Closest wins', g.closest],
  ['roulette', 'One random player is eliminated each round', g.roulette],
  ['boats', 'Text boat race. First across the line wins', g.boats],
  ['rps-tournament', 'Rock paper scissors knockout tournament', g.rpsTournament],
  ['hot-potato', 'Pass the potato before it blows up', g.hotPotato],
  ['typing-race', 'First to type the sentence wins the round', g.typingRace],
  ['trivia', 'Trivia knockout. Wrong answers are out', g.trivia],
  ['dice', 'Highest dice roll wins, ties reroll', g.dice],
  ['chests', 'Pick a chest. Only some hold the prize', g.chests],
  ['button', "Don't press the button", g.dontPress],
  ['number-elim', 'Pick numbers. The losing number is eliminated', g.numberElim],
];

const data = new SlashCommandBuilder()
  .setName('game')
  .setDescription('Start a mini game')
  .setDMPermission(false);

for (const [name, description] of GAMES) {
  data.addSubcommand((sub) => sub.setName(name).setDescription(description));
}

module.exports = {
  data,

  async execute(interaction) {
    const name = interaction.options.getSubcommand();
    const game = GAMES.find(([n]) => n === name);
    if (!game) return;
    await game[2](interaction);
  },
};
