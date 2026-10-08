import json
import time
import requests


def generate_recipe_with_fresh_session(prompt_text):
  # Step 1: Create a requests Session object to automatically save and send cookies
  session = requests.Session()

  headers = {
      'User-Agent': (
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101'
          ' Firefox/154.0'
      ),
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.troli.co.za/',
      'content-type': 'application/json',
      'Origin': 'https://www.troli.co.za',
      'Connection': 'keep-alive',
  }

  try:
    print(
        f"\n[*] Step 1: Requesting a fresh session for prompt:"
        f" '{prompt_text}'..."
    )

    # Hit the main site or their session endpoint first to generate a fresh cookie
    # (Depending on how they initialize it, hitting the homepage or the session API works)
    session.get('https://www.troli.co.za/', headers=headers)

    # Alternatively, if they have an explicit session creation endpoint you saw earlier:
    # session.post('https://api.troli.co.za/api/v1/session', headers=headers)

    # Step 2: Now send the recipe generation request using the session object
    # (The session object automatically includes any newly acquired cookies)
    url = 'https://api.troli.co.za/api/v1/recipe-lab/guest/generate'

    json_data = {
        'prompt': prompt_text,
        'servings': 4,
        'max_prep_time_minutes': 20,
        'max_cook_time_minutes': 35,
        'difficulty': 'easy',
        'cuisine': None,
        'dietary_tags': [],
        'avoid_ingredients': [],
        'challenge_token': None,
    }

    print('[*] Step 2: Sending recipe generation request...')
    response = session.post(url, headers=headers, json=json_data)

    if response.status_code == 200:
      print('[+] Success!')
      print(json.dumps(response.json(), indent=4))
    else:
      print(f'[-] Error {response.status_code}: {response.text}')

  except Exception as e:
    print(f'[-] Connection error: {e}')


if __name__ == '__main__':
  # Your list of multiple prompts
  prompts_to_try = [
      'chicken curry',
      'chocolate cake',
      'greek salad',
  ]

  for prompt in prompts_to_try:
    generate_recipe_with_fresh_session(prompt)
    time.sleep(2)  # Give it a couple seconds pause between iterations