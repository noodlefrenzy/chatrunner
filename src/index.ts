import * as dotenv from 'dotenv';
//import * as wrap from 'word-wrap';
import {Command} from 'commander';
import * as winston from 'winston';

import {OpenAI} from 'langchain';
//import {ConversationChain} from 'langchain/chains';
//import {BaseLLM} from 'langchain/llms';
//import {PromptTemplate} from 'langchain/prompts';

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

const model = new OpenAI({
  modelName: 'gpt-3.5-turbo',
  openAIApiKey: process.env.OPENAI_API_KEY,
  temperature: 0.8,
});

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
    const response = await model.generate([prompt]);
    console.log(JSON.stringify(response, null, 2));
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
