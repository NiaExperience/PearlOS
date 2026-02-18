import os
from openai import OpenAI

api_key = os.getenv("MINIMAX_API_KEY", "sk-cp-CTfAHxds-1ICiTQoiv1ax0zC2nv62Y9naLTWDMSv7Szh2moweS4DJ50mja0TCOO-cjQVujuSKuLTng14AQEiZQCvNRR-LoPWrEd7O0T3L3ZvsQZ9nhc-KqM")

client = OpenAI(
    api_key=api_key,
    base_url="https://api.minimax.io/v1"
)

try:
    response = client.chat.completions.create(
        model="MiniMax-M2.5",
        messages=[{"role": "user", "content": "Say 'MiniMax M2.5 is working!' in exactly those words."}],
        max_tokens=50
    )
    print("✅ SUCCESS:", response.choices[0].message.content)
except Exception as e:
    print("❌ ERROR:", str(e))
