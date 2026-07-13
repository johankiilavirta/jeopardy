/**
 * Mock clue content for the 6-column demo board.
 *
 * Indexed by clue id (column-major, see `clueIdAt` in board.ts). In the next
 * milestone this content comes from whoever hosts the game; `GameState` only
 * ever carries the single active clue.
 */

import { demoBoard } from './board';

const CLUE_TEXT: Record<number, { text: string; answer: string }> = {
  // POTENT POTABLES (col 0)
  0: {
    text: 'Worm salt & lime often accompany this agave spirit, Mexico\u2019s most famous export',
    answer: 'What is tequila?',
  },
  1: {
    text: 'James Bond prefers this gin & vermouth cocktail shaken, not stirred',
    answer: 'What is a martini?',
  },
  2: {
    text: 'This Cuban highball muddles white rum, mint, lime, sugar & soda water',
    answer: 'What is a mojito?',
  },
  3: {
    text: 'Single malt Scotch whisky must be made from this one malted grain',
    answer: 'What is barley?',
  },
  4: {
    text: 'Only 2 monks at a time may know the full 130-herb recipe of this green French liqueur',
    answer: 'What is Chartreuse?',
  },

  // WORLD CAPITALS (col 1)
  5: {
    text: 'You can see its City of Light from atop the Eiffel Tower',
    answer: 'What is Paris?',
  },
  6: {
    text: 'Canberra became a capital as a compromise between these 2 feuding Australian cities',
    answer: 'What are Sydney & Melbourne?',
  },
  7: {
    text: 'At nearly 12,000 feet, this Bolivian seat of government is the world\u2019s highest capital',
    answer: 'What is La Paz?',
  },
  8: {
    text: 'Ottawa sits on the border of Ontario & this French-speaking province',
    answer: 'What is Quebec?',
  },
  9: {
    text: 'This Kazakh capital was renamed Nur-Sultan in 2019, then changed back in 2022',
    answer: 'What is Astana?',
  },

  // BEFORE & AFTER (col 2)
  10: {
    text: 'Fairy-tale heroine with 7 dwarfs who lives at 1600 Pennsylvania Avenue',
    answer: 'What is Snow White House?',
  },
  11: {
    text: 'Web-slinging superhero hangs out in a basement room with a pool table & a big TV',
    answer: 'What is Spider-Man Cave?',
  },
  12: {
    text: '\u201cFootloose\u201d actor served sunny-side up with toast',
    answer: 'Who is Kevin Bacon and Eggs?',
  },
  13: {
    text: 'Boy wizard who sells rustic home furnishings & scented candles',
    answer: 'What is Harry Pottery Barn?',
  },
  14: {
    text: 'Victorian detective living where the deer & the antelope play',
    answer: 'What is Sherlock Holmes on the Range?',
  },

  // SCIENCE FICTION (col 3)
  15: {
    text: '\u201cMay the Force be with you\u201d comes from this 1977 space opera',
    answer: 'What is Star Wars?',
  },
  16: {
    text: 'Isaac Asimov\u2019s 3 laws govern the behavior of these artificial beings',
    answer: 'What are robots?',
  },
  17: {
    text: 'Keanu Reeves takes the red pill in this 1999 film',
    answer: 'What is The Matrix?',
  },
  18: {
    text: 'Frank Herbert novel set on the desert planet Arrakis, the only source of the spice melange',
    answer: 'What is Dune?',
  },
  19: {
    text: 'This author coined the term \u201ccyberspace\u201d in his 1984 novel \u201cNeuromancer\u201d',
    answer: 'Who is William Gibson?',
  },

  // 4-LETTER WORDS (col 4)
  20: {
    text: 'To strike a ball with your foot, or what a mule might give you',
    answer: 'What is kick?',
  },
  21: {
    text: 'A baker\u2019s dozen minus nine',
    answer: 'What is four?',
  },
  22: {
    text: 'Citrus fruit whose juice goes in a daiquiri \u2014 it rhymes with \u201ctime\u201d',
    answer: 'What is lime?',
  },
  23: {
    text: 'To jump on one foot, or the flowers that give beer its bitterness',
    answer: 'What are hops?',
  },
  24: {
    text: 'It can precede \u201cfall\u201d, \u201cbow\u201d & \u201ccoat\u201d',
    answer: 'What is rain?',
  },

  // MOVIE QUOTES (col 5)
  25: {
    text: 'In 1939, Dorothy says there is no place like this',
    answer: 'What is home?',
  },
  26: {
    text: 'This 1972 film gave us the offer that cannot be refused',
    answer: 'What is The Godfather?',
  },
  27: {
    text: 'This Arnold Schwarzenegger cyborg promised, “I\u2019ll be back”',
    answer: 'What is The Terminator?',
  },
  28: {
    text: 'In “When Harry Met Sally...”, Sally orders one of these at Katz\u2019s Deli',
    answer: 'What is a sandwich?',
  },
  29: {
    text: '“Why so serious?” is a line from this 2008 Batman film',
    answer: 'What is The Dark Knight?',
  },
};

export interface ClueContent {
  id: number;
  category: string;
  text: string;
  answer: string;
  value: number;
}

export function getClueContent(id: number): ClueContent {
  const col = Math.floor(id / 5);
  const row = id % 5;
  const category = demoBoard.categories[col];
  const cell = category?.clues[row];
  const content = CLUE_TEXT[id];
  if (!category || !cell || !content) {
    throw new Error(`No demo clue content for id ${id}`);
  }
  return {
    id,
    category: category.name,
    text: content.text,
    answer: content.answer,
    value: cell.value,
  };
}
