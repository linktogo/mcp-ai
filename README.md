# LK-AI Project

An intelligent agent project leveraging the Model Context Protocol (MCP) to interact with and respond to development tasks.

## About The Project

This project appears to be an AI-powered software engineering assistant. It's built on Node.js and utilizes the Model Context Protocol SDK to understand the context of a software project and perform tasks, such as generating documentation.

The agent is designed to be invoked via prompts, as seen in the `data/prompts` directory, to perform specific, high-level tasks.

## Technology Stack

*   **Runtime**: Node.js
*   **Core Protocol**: @modelcontextprotocol/sdk - For building agents that can understand and interact with project contexts.
*   **Data Validation**: Zod - For type-safe data validation.

## Getting Started

Follow these instructions to get a local copy up and running.

### Prerequisites

You need to have Node.js (version 18.x or higher recommended) and npm installed on your machine.

### Installation

1.  Clone the repository:
    ```sh
    git clone https://github.com/linktogo/mcp-ai
    cd lk_ai
    ```

2.  Install NPM packages:
    ```sh
    npm install
    ```

### Running the Application

The project includes a server component that is essential for the agent's operation.

To start the server, run the following command:

```sh
npm start
```

This will execute `node ./mcp_server.js` and start the MCP server.

## Usage

The agent's capabilities are defined by prompts located in the `data/prompts` directory. To interact with the agent, you can use the MCP inspector tools.

#### Inspecting the Agent

To view the agent's capabilities and available tools without running the server:
```sh
npm run inspect
```

#### Running the Inspector with the Server

To start the server and launch the interactive inspector simultaneously:
```sh
npm run inspector
```