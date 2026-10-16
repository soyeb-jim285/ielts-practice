-- OpenAI / Gemini own keys only unlocked the removed live engines: drop the stored secrets. The enum keeps its values (narrowing a pg enum needs a type rebuild).
DELETE FROM "user_api_keys" WHERE "provider" IN ('openai', 'gemini');
