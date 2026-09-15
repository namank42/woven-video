"""Run the authorized fixed AEO sample; never prints authentication values."""
import base64, concurrent.futures, configparser, json, pathlib, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
protocol = json.loads((ROOT / 'protocol.json').read_text())
config = configparser.ConfigParser(interpolation=None)
config.read(pathlib.Path.home() / '.codex/config.toml')
env = config['mcp_servers.dataforseo.env']
login = json.loads(env['DATAFORSEO_LOGIN'])
password = json.loads(env['DATAFORSEO_PASSWORD'])
auth = base64.b64encode((login + ':' + password).encode()).decode()

def cost(d):
    return max(d.get('cost', 0), sum(t.get('cost', 0) for t in d.get('tasks', [])))

def execute(job):
    engine, q, repeat = job
    target = ROOT / (engine + '-' + q['id'] + '-r' + str(repeat) + '.json')
    retry = target.with_name(target.stem + '-retry.json')
    if target.exists():
        return {'engine': engine, 'id': q['id'], 'repeat': repeat, 'skipped': True}
    if engine == 'chatgpt':
        path = '/v3/ai_optimization/chat_gpt/llm_scraper/live/advanced'
        task = dict(keyword=q['question'], location_name='United States', language_code='en', force_web_search=True)
    elif engine == 'perplexity':
        path = '/v3/ai_optimization/perplexity/llm_responses/live'
        task = dict(user_prompt=q['question'], model_name='sonar-pro', max_output_tokens=2048, web_search_country_iso_code='US')
    else:
        path = '/v3/serp/google/organic/live/advanced'
        task = dict(keyword=q['question'], location_name='United States', language_code='en', depth=10, load_async_ai_overview=True)
    task['tag'] = 'woven-baseline-20260908-' + q['id'] + '-r' + str(repeat)
    request = urllib.request.Request('https://api.dataforseo.com' + path, data=json.dumps([task]).encode(), headers={'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json'})
    record = dict(engine=engine, question_id=q['id'], repeat=repeat, request=task, started_at=time.time())
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            record['response'] = json.load(response)
    except Exception as error:
        record['transport_error'] = type(error).__name__
    record['finished_at'] = time.time()
    target.write_text(json.dumps(record, ensure_ascii=False))
    d = record.get('response', {})
    return dict(engine=engine, id=q['id'], repeat=repeat, status=[t.get('status_code') for t in d.get('tasks', [])], cost=cost(d), transport_error=record.get('transport_error'))

if __name__ == '__main__':
    # Three separate waves avoid simultaneous duplicate prompts. They are still correlated same-day observations.
    for repeat in range(1, 4):
        jobs = [(engine, q, repeat) for q in protocol['questions'] for engine in ['chatgpt', 'perplexity', 'google']]
        with concurrent.futures.ThreadPoolExecutor(max_workers=9) as pool:
            for result in pool.map(execute, jobs):
                print(json.dumps(result), flush=True)
        total = sum(cost(json.loads(p.read_text()).get('response', {})) for p in ROOT.glob('*-Q*-r*.json'))
        print(json.dumps({'wave_completed': repeat, 'conservative_total_usd': total}), flush=True)
        if total > 3:
            print('Stopping before next wave to stay within the $5 ceiling.', flush=True)
            break
