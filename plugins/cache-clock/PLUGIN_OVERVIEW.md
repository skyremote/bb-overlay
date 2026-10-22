# Cache Clock

A countdown above the chat box that shows how long your Claude chat stays cheap to continue. Each reply leaves a saved copy of the chat (the prompt cache) on the provider's side for a limited time; after that, the next message re-reads everything at full price.

Press **Keep warm** before you step away and the plugin sends a small visible ping just before the cache expires, until you come back or two hours pass. Press **Hand off** when a chat has grown long: the chat writes a complete brief and a new chat opens with it, ready for you to send.

The countdown is measured from the last reply, with the cache length as a setting (60 minutes for a Claude subscription, 5 for an API key), because bb does not report the provider's own timer.
