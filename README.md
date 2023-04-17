# chatrunner

CLI for simple call/response and multi-round conversations with LLMs.

## Structure

Typically prompts will be delivered from the command line for call/response, but looking into file-based (likely text) for multi-round self-conversations.

## Usage

```
Usage: chatrunner [options] [command]

CLI for invoking an LLM in either a single call or a back-and-forth session

Options:
  -V, --version   output the version number
  -d, --debug     Enable debug logging
  -h, --help      display help for command

Commands:
  respond         Generate the given prompt
  help [command]  display help for command


Examples:
  $ <something that generates a prompt> | chatrunner respond

```

```
Usage: chatrunner respond [options]

Generate the given prompt

Options:
  -h, --help  display help for command
```
