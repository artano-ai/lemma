# Using the MCP server

`@artano-ai/mcp-server` exposes the cards corpus and the
verification engine over the Model Context Protocol. Any MCP-aware
runtime (Claude Code, Cursor, Codex, Goose, …) can drop it in and
gain a set of tool calls for scientific verification.

## Install

```sh
npx @artano-ai/mcp-server
```

That runs the server over stdio. You normally do not run it
directly; you point an agent runtime at it via config.

## Tools the server exposes

| Tool | What it does |
| --- | --- |
| `cards_list` | List the curated cards. Optional `domain` substring filter. |
| `cards_get` | Fetch a full card record (PrincipleCard or HypothesisCard) by id. Refuses to fabricate — unknown ids produce a structured error listing valid ids. |
| `ops_get` | Fetch an OpsCard rendered as Markdown for direct LLM consumption. |
| `hypothesis_crosscheck` | Run the cross-check engine on a HypothesisCard. Pass either an existing `id` or an inline `card` object. Verifies dimensional analysis, reference-corpus resolution, declared limit / conservation claims, and `derivedFrom` link resolution. |
| `rag_lookup` | Retrieve passages from a Postgres + pgvector corpus indexed over the Siesta manual, ASE, pymatgen, numerical-methods notes, and SLURM / MareNostrum docs. |
| `parse_siesta_fdf` | Read Siesta `.fdf` input files. Handles `%block`/`%endblock`, scalar values with optional units, and Siesta's case-insensitive label convention. |
| `parse_eig_file` | Read Siesta `.EIG` files. Computes Fermi level, VBM / CBM per spin, band gap, metallic detection. |
| `generate_slurm` | Produce a SLURM batch script. Defaults tuned for MareNostrum 5 partitions; valid on any SLURM cluster. |

The server deliberately omits `read_file`, `write_file`,
`list_files`, and `run_shell`. Every modern tool-use runtime already
provides those. The Lemma server adds the *scientific* layer on top.

## Claude Code

Add to your `~/.claude.json`:

```jsonc
{
  "mcpServers": {
    "lemma": {
      "command": "npx",
      "args": ["@artano-ai/mcp-server"]
    }
  }
}
```

## Cursor

Add to `~/.cursor/mcp.json`:

```jsonc
{
  "mcpServers": {
    "lemma": {
      "command": "npx",
      "args": ["@artano-ai/mcp-server"]
    }
  }
}
```

## Codex

Add to your Codex agent config (see Codex docs for the exact path):

```jsonc
{
  "mcp_servers": [
    {
      "name": "lemma",
      "command": "npx",
      "args": ["@artano-ai/mcp-server"]
    }
  ]
}
```

## Generic stdio invocation

The server speaks MCP over stdio. Any MCP client library can speak
to it directly:

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npx @artano-ai/mcp-server
```

## Environment

By default the server reads cards from the package's bundled
corpus. To point it at a different corpus (for example a private
fork), set:

```sh
LEMMA_CARDS_DIR=/path/to/your/cards npx @artano-ai/mcp-server
```

## See also

* [`getting-started.md`](./getting-started.md) for the bigger
  picture.
* The server's own README in
  [`../mcp-server/README.md`](https://github.com/artano-ai/lemma/blob/main/mcp-server/README.md) for
  contributor-level detail.
