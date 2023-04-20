import * as dotenv from 'dotenv';
import { Command } from 'commander';
import * as fs from 'fs';
import { parse } from 'yaml';
import * as winston from 'winston';
import * as readline from 'readline';

import { OpenAI } from 'langchain/llms/openai';
import { LLMResult } from 'langchain/schema';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import {
  AgentExecutor,
  initializeAgentExecutorWithOptions,
} from "langchain/agents";
import { Calculator } from 'langchain/tools/calculator';
import { BaseMemory, BufferMemory, ConversationSummaryMemory } from 'langchain/memory';
import { LLMChain } from 'langchain/chains';
import { PromptTemplate } from 'langchain/prompts';

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

function getModel(temperature = 0.8) {
  return new OpenAI({
    modelName: 'gpt-3.5-turbo',
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: temperature,
  });
}

function getLLMChain(temperature = 0.8, memoryType = 'buffer') {
  let memory: BaseMemory;
  if (memoryType === 'buffer') {
    memory = new BufferMemory({
      memoryKey: 'chat_history',
    });
  } else {
    memory = new ConversationSummaryMemory({
      memoryKey: 'chat_history',
      llm: new ChatOpenAI({
        modelName: "gpt-3.5-turbo",
        openAIApiKey: process.env.OPENAI_API_KEY,
        temperature: 0,
      }),
    });
  }

  const model = new ChatOpenAI({
    modelName: "gpt-3.5-turbo",
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: temperature,
  });
  const prompt =
    PromptTemplate.fromTemplate(`The following is a friendly conversation between a human and an AI. 
    Current conversation:
    {chat_history}
    Human: {input}
    AI:`);

  return new LLMChain({ llm: model, prompt, memory });
}

async function getAgent(temperature = 0.8): Promise<AgentExecutor> {
  const model = new ChatOpenAI({
    modelName: "gpt-3.5-turbo",
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: temperature,
  });
  const tools = [new Calculator()];

  const executor = await initializeAgentExecutorWithOptions(tools, model, {
    agentType: "chat-conversational-react-description",
    verbose: true,
  });
  console.log('Loaded agent.');
  return executor;
}

function getPromptFromInput(): Promise<string> {
  process.stdin.setEncoding('utf8');

  let input = '';

  return new Promise((resolve) => {
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
  const yamlString = fs.readFileSync(`${filename}.yaml`, 'utf8');
  return parse(yamlString);
}

function textFromResponse(response: LLMResult): string {
  // TODO: Add error handling
  return response.generations[0][0].text;
}

async function interactiveChat(): Promise<void> {
  const agent = await getLLMChain();
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

    const response = await agent.call({ input: prompt });
    console.log(`Bot>\n${response.text}\n===`);
  }
}

// NOTE: Currently investigating agents failure to remember
// across call invocations
async function selfChatWithAgent(convoSpec: any): Promise<void> {
  const bots = new Map<string, any>();
  for (let i = 0; i < convoSpec.actors.length; i++) {
    const actor = convoSpec.actors[i];
    bots.set(actor.name, {
      agent: await getAgent(),
      spec: actor,
    });
  }

  for (let i = 0; i < convoSpec.conversation.length; i += 1) {
    const curPhase = convoSpec.conversation[i];
    logger.debug(`Phase ${i}: ${JSON.stringify(curPhase)}`);
    console.log(`Phase ${i}: ${curPhase.name}\n===`);
    for (let i = 0; i < curPhase.actors.length; i += 1) {
      const actor = curPhase.actors[i];
      const bot = bots.get(actor);
      const priming = await bot.agent.call({ input: bot.spec.prompt });
      bot["lastResponse"] = priming.output;
      console.log(`priming ${actor}>\n${bot.spec.prompt}\n===`);
      console.log(`${actor} Setup>\n${priming.output}\n===`);
    }

    if (curPhase.kickstart) {
      const actor1 = curPhase.actors[0];
      const bot1 = bots.get(actor1);
      let kickstartMessage = curPhase.kickstart;
      if (curPhase.kickstart.endsWith('.lastResponse')) {
        const kickstartActor = curPhase.kickstart.split('.')[0];
        logger.debug(`Kickstarting with ${kickstartActor}'s last response`);
        kickstartMessage = bots.get(kickstartActor).lastResponse;
      }
      const kickstart = await bot1.agent.call({ input: kickstartMessage });
      bot1["lastResponse"] = kickstart.output;
      console.log(`kickstarting ${actor1}>\n${kickstartMessage}\n===`);
      console.log(`${actor1} Kickstart>\n${kickstart.output}\n===`);
    }

    const stopPhrase = curPhase.ends.stopPhrase;
    for (let j = 0; j < curPhase.ends.numRounds; j += 1) {
      for (let k = 0; k < curPhase.actors.length; k += 1) {
        const prevActor = curPhase.actors[k];
        const prevBot = bots.get(prevActor);
        const curActor = curPhase.actors[k + (1 % curPhase.actors.length)];
        const curBot = bots.get(curActor);
        if (prevBot && curBot) {
          console.log(
            `\nSending ${prevActor}s last response to ${curActor}>\n${prevBot.lastResponse}\n===`
          );
          const response = await curBot.agent.call({
            input: prevBot.lastResponse,
          });
          curBot["lastResponse"] = response.output;
          console.log(`${curActor}>\n${response.output}\n===`);
          if (response.output.includes(stopPhrase)) {
            break;
          }
        }
      }
    }
  }

  return Promise.resolve();
}

async function selfChatWithChain(convoSpec: any): Promise<void> {
  const bots = new Map<string, any>();
  for (let i = 0; i < convoSpec.actors.length; i++) {
    const actor = convoSpec.actors[i];
    bots.set(actor.name, {
      agent: await getLLMChain(),
      spec: actor,
    });
  }

  for (let i = 0; i < convoSpec.conversation.length; i += 1) {
    const curPhase = convoSpec.conversation[i];
    logger.debug(`Phase ${i}: ${JSON.stringify(curPhase)}`);
    console.log(`Phase ${i}: ${curPhase.name}\n===`);
    for (let i = 0; i < curPhase.actors.length; i += 1) {
      const actor = curPhase.actors[i];
      const bot = bots.get(actor);
      const priming = await bot.agent.call({ input: bot.spec.prompt });
      bot["lastResponse"] = priming.text;
      console.log(`priming ${actor}>\n${bot.spec.prompt}\n===`);
      console.log(`${actor} Setup>\n${priming.text}\n===`);
    }

    if (curPhase.kickstart) {
      const actor1 = curPhase.actors[0];
      const bot1 = bots.get(actor1);
      let kickstartMessage = curPhase.kickstart;
      if (curPhase.kickstart.endsWith('.lastResponse')) {
        const kickstartActor = curPhase.kickstart.split('.')[0];
        logger.debug(`Kickstarting with ${kickstartActor}'s last response`);
        kickstartMessage = bots.get(kickstartActor).lastResponse;
      }
      const kickstart = await bot1.agent.call({ input: kickstartMessage });
      bot1["lastResponse"] = kickstart.text;
      console.log(`kickstarting ${actor1}>\n${kickstartMessage}\n===`);
      console.log(`${actor1} Kickstart>\n${kickstart.text}\n===`);
    }

    const stopPhrase = curPhase.ends.stopPhrase;
    phraseLoop: for (let j = 0; j < curPhase.ends.numRounds; j += 1) {
      for (let k = 0; k < curPhase.actors.length; k += 1) {
        const prevActor = curPhase.actors[k];
        const prevBot = bots.get(prevActor);
        const curActor = curPhase.actors[k + (1 % curPhase.actors.length)];
        const curBot = bots.get(curActor);
        if (prevBot && curBot) {
          console.log(
            `\nSending ${prevActor}s last response to ${curActor}>\n${prevBot.lastResponse}\n===`
          );
          const response = await curBot.agent.call({
            input: prevBot.lastResponse,
          });
          curBot["lastResponse"] = response.text;
          console.log(`${curActor}>\n${response.text}\n===`);
          if (response.text.includes(stopPhrase)) {
            logger.debug(`Breaking out of phrase loop, found stop phrase`);
            break phraseLoop;
          } else {
            logger.debug(`Response\n${response.text}\n=== does not include stop phrase ${stopPhrase}`);
          }
        }
      }
    }
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
    const conversation = readYaml(options.file);
    logger.debug(`conversation: ${JSON.stringify(conversation, null, 2)}`);
    await selfChatWithChain(conversation);
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
