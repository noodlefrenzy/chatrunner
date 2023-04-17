import * as dotenv from 'dotenv';
import {Command} from 'commander';
import * as fs from 'fs';
import {parse} from 'yaml';
import * as winston from 'winston';
import * as readline from 'readline';

import {OpenAI} from 'langchain/llms/openai';
import { LLMResult } from 'langchain/schema';

dotenv.config();

const logger = winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.Console({
      level: 'info',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

function getModel() {
  return new OpenAI({
    modelName: 'gpt-3.5-turbo',
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.8,
  });
}

function getPromptFromInput(): Promise<string> {
  process.stdin.setEncoding('utf8');

  let input = '';

  return new Promise(resolve => {
    process.stdin.on('data', (chunk: string) => {
      logger.debug(`Chunk: ${chunk}`);
      input += chunk;
    });

    process.stdin.on('end', () => {
      logger.debug(`End: ${input}`);
      resolve(input);
    });
  });
}

function readYaml(filename: string) {
  const yamlString = fs.readFileSync(`${filename}.yaml`,'utf8');
  return parse(yamlString);  
}

function textFromResponse(response: LLMResult): string {
  // TODO: Add error handling
  return response.generations[0][0].text;
}

async function interactiveChat(): Promise<void> {
  const model = getModel();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  while (true) {
    const prompt = await new Promise<string>((resolve) => {
      rl.question('You (Q to quit)>\n', (input) => {
        resolve(input);
      });
    });

    if (prompt === 'Q') {
      rl.close();
      return;
    }

    const response = await model.generate([prompt]);
    console.log(`Bot>\n${textFromResponse(response)}`);
  }
}

async function selfChat(bot1Name: string, bot1Prompt: string, bot1Kickstart: string, 
  bot2Name: string, bot2Prompt: string,
  numRounds: number = 2) : Promise<void> {

    const bot1 = getModel();
    const bot2 = getModel();

    logger.debug(`Prompting ${bot1Name} with ${bot1Prompt}\n===`);
    let response = await bot1.generate([bot1Prompt]);
    console.log(`${bot1Name} Setup>\n${textFromResponse(response)}\n===`);

    logger.debug(`Prompting ${bot2Name} with ${bot2Prompt}\n===`);
    let response2 = await bot2.generate([bot2Prompt]);
    console.log(`${bot2Name} Setup>\n${textFromResponse(response2)}\n===`);

    logger.debug(`Kickstarting ${bot1Name} with ${bot1Kickstart}\n===`);
    response = await bot1.generate([bot1Kickstart]);
    console.log(`${bot1Name} Kickstart the Conversation>\n${textFromResponse(response)}\n===`);

    let curRound = 0;
    let timeToQuit = () => {
      return (curRound > numRounds);
    };

    while (!timeToQuit()) {
      response2 = await bot2.generate([textFromResponse(response)]);
      console.log(`${bot2Name}>\n${textFromResponse(response2)}\n===`);

      response = await bot1.generate([textFromResponse(response2)]);
      console.log(`${bot1Name}>\n${textFromResponse(response)}\n===`);

      logger.debug(`Ending round ${curRound} of ${numRounds}`);
      curRound += 1;
    }

    return Promise.resolve();
}

const program = new Command();

program
  .name('chatrunner')
  .description(
    'CLI for invoking an LLM in either a single call or a back-and-forth session'
  )
  .version('0.0.1')
  .option('-d, --debug', 'Enable debug logging');

program
  .command('respond')
  .description('Generate the given prompt')
  .action(async () => {
    if (program.opts().debug) {
      logger.transports[0].level = 'debug';
    }
    logger.debug(`program opts: ${JSON.stringify(program.opts())}`);
    const prompt = await getPromptFromInput();
    logger.debug(`Prompt: ${prompt}`);
    const response = await getModel().generate([prompt]);
    console.log(JSON.stringify(response, null, 2));
  });

program
  .command('chat')
  .description('Start an interactive chat session')
  .action(async () => {
    if (program.opts().debug) {
      logger.transports[0].level = 'debug';
    }
    logger.debug(`program opts: ${JSON.stringify(program.opts())}`);
    await interactiveChat();
  });

program
  .command('selfchat')
  .description('Start a self chat session, where two bots talk to each other')
  .requiredOption('-f, --file <file>', 'File containing the prompts')
  .option('-n, --num-rounds <number>', 'Number of rounds to run', '2')
  .action(async (options) => {
    if (program.opts().debug) {
      logger.transports[0].level = 'debug';
    }
    logger.debug(`program opts: ${JSON.stringify(program.opts())}`);
    logger.debug(`options: ${JSON.stringify(options)}`);
    const bots = readYaml(options.file);
    await selfChat(bots.bot1.name, bots.bot1.prompt, bots.bot1.kickstart, 
      bots.bot2.name, bots.bot2.prompt, parseInt(options.numRounds));
  });

program.addHelpText(
  'after',
  `

Examples:
  $ <something that generates a prompt> | chatrunner respond
`
);

program.showHelpAfterError();

program.parse();
