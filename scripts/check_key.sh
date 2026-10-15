#!/bin/zsh
# Verifies the key in .env against the OpenAI API (prints status only, never the key).
cd "${0:A:h}/.."
KEY=$(grep -E '^OPENAI_API_KEY=' .env | cut -d= -f2- | tr -d '[:space:]"')
[[ -z "$KEY" ]] && { echo "❌ .env has no OPENAI_API_KEY yet"; exit 1; }
CODE=$(curl -s -o /tmp/jarvis_keycheck.json -w "%{http_code}" --max-time 15 \
  https://api.openai.com/v1/models -H "Authorization: Bearer $KEY")
if [[ "$CODE" == "200" ]]; then
  echo "✅ Key works. Models available:"
  python3 -c "import json;ids=sorted(m['id'] for m in json.load(open('/tmp/jarvis_keycheck.json'))['data']);print('\n'.join(i for i in ids if i.startswith(('gpt-5','gpt-4.1','gpt-4o','o3','o4'))))"
else
  echo "❌ HTTP $CODE"; python3 -c "import json;print(json.load(open('/tmp/jarvis_keycheck.json')).get('error',{}).get('message',''))" 2>/dev/null
fi
rm -f /tmp/jarvis_keycheck.json
