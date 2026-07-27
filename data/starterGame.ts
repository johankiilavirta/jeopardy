import type { CategoryData, GameData } from './gameLoader';

type CluePair = readonly [text: string, answer: string];

function category(name: string, clues: readonly CluePair[], multiplier = 1): CategoryData {
  return {
    name,
    clues: clues.map(([text, answer], index) => ({
      value: (index + 1) * 200 * multiplier,
      text,
      answer,
    })),
  };
}

/**
 * Project-owned original fallback content. Game 0 is deliberately outside the
 * 1…N range assigned to user-imported question libraries.
 */
export const STARTER_GAME: GameData = {
  gameNumber: 0,
  airDate: 'BUILT-IN STARTER',
  round1: [
    category('MATHEMATICIANS', [
      ['This ancient Greek mathematician wrote the geometry textbook known as “Elements”', 'Who is Euclid?'],
      ['A famous theorem bearing this Frenchman’s name went unproved for more than 350 years', 'Who is Pierre de Fermat?'],
      ['Her notes on Charles Babbage’s Analytical Engine included an algorithm for computing Bernoulli numbers', 'Who is Ada Lovelace?'],
      ['This German mathematician founded set theory and developed the mathematics of transfinite numbers', 'Who is Georg Cantor?'],
      ['After proving the Poincaré conjecture, this Russian mathematician declined the 2006 Fields Medal', 'Who is Grigori Perelman?'],
    ]),
    category('PHYSICS', [
      ['Electrical resistance is measured in this unit, symbolized by the Greek letter omega', 'What is the ohm?'],
      ['In a vacuum, light travels at about 300,000 of these metric units per second', 'What are kilometers?'],
      ['This principle says that position and momentum cannot both be known with unlimited precision', 'What is the uncertainty principle?'],
      ['Bosons take their name from this Indian physicist, who worked with Einstein on quantum statistics', 'Who is Satyendra Nath Bose?'],
      ['A theorem by this German mathematician connects every continuous symmetry of nature with a conservation law', 'Who is Emmy Noether?'],
    ]),
    category('THE ENLIGHTENMENT', [
      ['This English thinker described natural rights to life, liberty and property', 'Who is John Locke?'],
      ['This French satirist sent the endlessly optimistic Pangloss through the disasters of “Candide”', 'Who is Voltaire?'],
      ['His “Spirit of the Laws” argued for separating government into distinct powers', 'Who is Montesquieu?'],
      ['This editor led the vast French reference work called the “Encyclopédie”', 'Who is Denis Diderot?'],
      ['“Sapere aude”—“dare to know”—was the motto of Enlightenment in an essay by this philosopher', 'Who is Immanuel Kant?'],
    ]),
    category('TRAINS', [
      ['This engine-powered rail vehicle pulls the rest of a train', 'What is a locomotive?'],
      ['Traditionally found at the rear of a freight train, this car provided shelter and workspace for the crew', 'What is a caboose?'],
      ['Japan’s high-speed “bullet train” network is known by this name', 'What is the Shinkansen?'],
      ['The Union Pacific and Central Pacific railroads were joined at this Utah summit in 1869', 'What is Promontory Summit?'],
      ['George Stephenson’s locomotive with this speedy name won the Rainhill Trials in 1829', 'What is the Rocket?'],
    ]),
    category('INTERNET SLANG', [
      ['BRB expands to this three-word promise of a quick return', 'What is “be right back”?'],
      ['To contact someone privately on social media, you might send this two-letter kind of message', 'What is a DM?'],
      ['Often placed before a summary, TL;DR expands to this phrase', 'What is “too long; didn’t read”?'],
      ['In a discussion thread, OP commonly refers to this person—or to that person’s initial message', 'What is the original poster?'],
      ['A block of text repeatedly copied and pasted across the internet is known by this blended term', 'What is copypasta?'],
    ]),
    category('GEOGRAPHY', [
      ['This is Earth’s largest ocean', 'What is the Pacific Ocean?'],
      ['Nairobi is the capital of this East African country', 'What is Kenya?'],
      ['Lake Titicaca lies on the border of these two South American countries', 'What are Peru and Bolivia?'],
      ['Bounded by ocean currents rather than coastlines, this Atlantic sea is named for its floating seaweed', 'What is the Sargasso Sea?'],
      ['Except for its Atlantic coast, The Gambia is surrounded by this country', 'What is Senegal?'],
    ]),
  ],
  round2: [
    category('RUSSIAN WRITERS', [
      ['He wrote both “War and Peace” and “Anna Karenina”', 'Who is Leo Tolstoy?'],
      ['Raskolnikov wrestles with guilt in this author’s “Crime and Punishment”', 'Who is Fyodor Dostoevsky?'],
      ['This playwright created “The Seagull”, “Uncle Vanya” and “The Cherry Orchard”', 'Who is Anton Chekhov?'],
      ['His verse novel “Eugene Onegin” gave Russian literature one of its defining works', 'Who is Alexander Pushkin?'],
      ['This author set his dystopian novel “We” in the regimented society called OneState', 'Who is Yevgeny Zamyatin?'],
    ], 2),
    category('FOREIGN HOLIDAYS', [
      ['Mexico’s Día de los Muertos welcomes the memory of departed loved ones by this English name', 'What is the Day of the Dead?'],
      ['Lamps, fireworks and sweets brighten this Hindu festival whose name is often translated as “row of lights”', 'What is Diwali?'],
      ['In Japan, a cluster of national holidays from late April into early May is known by this colorful name', 'What is Golden Week?'],
      ['Water splashing is a famous part of this traditional Thai New Year festival', 'What is Songkran?'],
      ['On December 13, white-robed, candle-bearing processions mark this Swedish celebration', 'What is Lucia Day?'],
    ], 2),
    category('DESSERTS', [
      ['Espresso-soaked ladyfingers and mascarpone are layered in this Italian dessert', 'What is tiramisu?'],
      ['Layers of phyllo, chopped nuts and syrup or honey make up this pastry', 'What is baklava?'],
      ['This meringue-based dessert was named for a Russian ballerina', 'What is pavlova?'],
      ['A fluted pastry from Bordeaux with a caramelized crust and custardy center bears this name', 'What is a canelé?'],
      ['Franz Sacher created this chocolate-and-apricot cake in Vienna', 'What is Sachertorte?'],
    ], 2),
    category('HISTORICAL HORSES', [
      ['Alexander the Great named a city for this beloved horse', 'Who is Bucephalus?'],
      ['Napoleon’s famous warhorse shared his name with an 1800 French victory', 'Who is Marengo?'],
      ['The Duke of Wellington rode this horse at the Battle of Waterloo', 'Who is Copenhagen?'],
      ['This gray horse carried Robert E. Lee during much of the American Civil War', 'Who is Traveller?'],
      ['This mare became a decorated U.S. Marine after carrying ammunition during the Korean War', 'Who is Sergeant Reckless?'],
    ], 2),
    category('THE SOLAR SYSTEM', [
      ['This is the largest planet in the solar system', 'What is Jupiter?'],
      ['On this planet, one rotation takes longer than one trip around the Sun', 'What is Venus?'],
      ['This enormous canyon system stretches across the surface of Mars', 'What is Valles Marineris?'],
      ['This dwarf planet is the largest object in the asteroid belt between Mars and Jupiter', 'What is Ceres?'],
      ['Triton, a large moon with a retrograde orbit, circles this planet', 'What is Neptune?'],
    ], 2),
    category('CANADA', [
      ['This city is Canada’s capital', 'What is Ottawa?'],
      ['The current red-and-white flag with its single maple leaf was first raised in this year', 'What is 1965?'],
      ['This is Canada’s only constitutionally bilingual province', 'What is New Brunswick?'],
      ['This Nunavut island is the largest island in Canada', 'What is Baffin Island?'],
      ['Canada’s name is derived from “kanata”, an Indigenous word meaning this kind of community', 'What is a village or settlement?'],
    ], 2),
  ],
  final: {
    category: 'VICTOR HUGO',
    text: 'This Channel Island was home to Hugo’s exile residence, Hauteville House, where he created works including “Les Misérables”',
    answer: 'What is Guernsey?',
  },
};
