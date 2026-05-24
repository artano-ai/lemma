"""Python MCP client for Lemma.

Thin async wrapper around the official ``mcp`` Python SDK that
provides a friendly Pythonic surface for talking to any Lemma MCP
server — whether the Node ``@artano-ai/mcp-server``, the Python
``lemma-mcp`` (this package's own server), or a remote MCP endpoint.

Usage::

    import asyncio
    from artano_lemma.client import connect_lemma_stdio

    async def main():
        async with connect_lemma_stdio() as client:
            cards = await client.cards_list(domain="physics-")
            print(cards)

            verdict = await client.hypothesis_crosscheck(
                card={
                    "kind": "hypothesis",
                    "id": "test",
                    "version": "0.1.0",
                    "name": "Test",
                    "proposal": "...",
                    "proposedFormulaTeX": "...",
                    "checks": {},
                    "references": [],
                    "origin": "llm",
                }
            )
            print(verdict)

    asyncio.run(main())

By default :func:`connect_lemma_stdio` spawns ``lemma-mcp`` on PATH;
override the ``command`` / ``args`` to point at the Node server
(``npx @artano-ai/mcp-server``) or any other MCP-compatible
binary.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


# ---------------------------------------------------------------------------
# LemmaClient
# ---------------------------------------------------------------------------


class LemmaClient:
    """A typed wrapper around an MCP :class:`ClientSession`.

    Construct via :func:`connect_lemma_stdio` (or via the lower-level
    :func:`connect_lemma_session` if you already have a session and
    just want the typed surface).
    """

    def __init__(self, session: ClientSession) -> None:
        self._session = session

    @property
    def session(self) -> ClientSession:
        """The underlying MCP client session. Use for tool calls beyond
        the four typed wrappers, or for ``list_tools``,
        ``list_resources``, etc."""
        return self._session

    # -- typed tool wrappers --------------------------------------------

    async def cards_list(self, *, domain: str | None = None) -> str:
        """List cards as Markdown. Optional case-insensitive substring
        filter on ``card.domain``; pass ``"ops"`` to filter to ops
        cards only."""
        return await self._call("cards_list", {"domain": domain or ""})

    async def cards_get(self, card_id: str) -> str:
        """Fetch one card's full JSON record as a string."""
        return await self._call("cards_get", {"id": card_id})

    async def ops_get(self, card_id: str) -> str:
        """Fetch one OpsCard rendered as Markdown."""
        return await self._call("ops_get", {"id": card_id})

    async def hypothesis_crosscheck(
        self,
        *,
        id: str | None = None,  # noqa: A002 — matches the MCP arg name
        card: dict[str, Any] | None = None,
    ) -> str:
        """Run the cross-check engine on a HypothesisCard.

        Either ``id`` (an existing card) or ``card`` (an inline JSON
        record) must be provided.
        """
        if id is None and card is None:
            raise ValueError(
                "Provide either `id` (existing card) or `card` "
                "(inline HypothesisCard JSON)."
            )
        args: dict[str, Any] = {}
        if id is not None:
            args["id"] = id
        if card is not None:
            args["card"] = card
        return await self._call("hypothesis_crosscheck", args)

    # -- internals ------------------------------------------------------

    async def _call(self, tool: str, arguments: dict[str, Any]) -> str:
        """Call a tool, return its first text-content block."""
        result = await self._session.call_tool(tool, arguments=arguments)
        if getattr(result, "isError", False):
            raise LemmaToolError(tool, _extract_text(result) or "(no detail)")
        return _extract_text(result) or ""


class LemmaToolError(RuntimeError):
    """Raised when an MCP tool call returns isError=True.

    Carries the tool name and the server-side error message.
    """

    def __init__(self, tool: str, message: str) -> None:
        self.tool = tool
        self.message = message
        super().__init__(f"{tool}: {message}")


def _extract_text(result: Any) -> str:
    """Pull the concatenated text content out of a CallToolResult.

    The MCP CallToolResult.content is a list of content blocks
    (TextContent, ImageContent, ...). For our Lemma tools every
    response is text; this helper joins every text block in order.
    """
    parts: list[str] = []
    for block in getattr(result, "content", []) or []:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            parts.append(text)
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------


@asynccontextmanager
async def connect_lemma_stdio(
    command: str = "lemma-mcp",
    args: list[str] | None = None,
    env: dict[str, str] | None = None,
) -> AsyncIterator[LemmaClient]:
    """Spawn a Lemma MCP server over stdio and yield a typed client.

    :param command: the executable to spawn. Default is
        ``lemma-mcp`` (this package's own console script). To talk
        to the Node server pass ``command="npx",
        args=["@artano-ai/mcp-server"]``.
    :param args: optional extra args passed to ``command``.
    :param env: optional environment overrides forwarded to the
        spawned process.
    """
    params = StdioServerParameters(
        command=command,
        args=list(args or []),
        env=env,
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield LemmaClient(session)


@asynccontextmanager
async def connect_lemma_session(session: ClientSession) -> AsyncIterator[LemmaClient]:
    """Wrap an already-initialised :class:`ClientSession` as a LemmaClient.

    Useful when the caller is multiplexing multiple MCP servers
    through one runtime and already owns the session lifecycle.
    """
    yield LemmaClient(session)


__all__ = [
    "LemmaClient",
    "LemmaToolError",
    "connect_lemma_stdio",
    "connect_lemma_session",
]
