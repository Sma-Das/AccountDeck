"""One metadata operation over stdin/stdout. GitHub credentials stay in gh."""
import json
from pathlib import Path
import socket
import sys
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).parent / 'vendor'))
from ghr import __version__
from ghr.core import RouterError, accounts, add_mapping, config_path, read_config, remove_mapping, scan
from ghr.machines import add_machine, list_machines, remote_request, remove_machine, sanitize


def mapping_body(body, remove=False):
    keys = ('path', 'host') if remove else ('path', 'host', 'account')
    if not isinstance(body, dict) or not all(isinstance(body.get(key), str) and body[key] for key in keys):
        raise RouterError('Enter a folder, hostname, and signed-in account.')
    result = {key: body[key] for key in keys}
    if body.get('repo'):
        if not isinstance(body['repo'], str):
            raise RouterError('Use a repository in OWNER/REPO format.')
        result['repo'] = body['repo']
    return result


def handle(data):
    endpoint = data.get('endpoint')
    method = data.get('method', 'GET')
    machine = data.get('machine', 'local')
    body = data.get('body')
    if not isinstance(machine, str):
        raise RouterError('Choose a computer.')
    if endpoint == 'machines':
        if method == 'GET':
            return {'machines': list_machines()}
        if method not in ('PUT', 'DELETE') or not isinstance(body, dict) or not isinstance(body.get('name'), str):
            raise RouterError('Enter a computer name.')
        if method == 'DELETE':
            remove_machine(body['name'])
            return {'removed': True}
        if not isinstance(body.get('url'), str):
            raise RouterError('Enter the complete dashboard session URL.')
        return add_machine(body['name'], body['url'])
    if (method, endpoint) not in [('GET', 'state'), ('GET', 'scan'), ('PUT', 'mappings'), ('DELETE', 'mappings')]:
        raise RouterError('Unknown GitHub workspace operation.')
    if endpoint == 'mappings':
        body = mapping_body(body, method == 'DELETE')
    path = '/api/' + endpoint
    if endpoint == 'scan':
        folder = data.get('path')
        if not isinstance(folder, str) or not folder:
            raise RouterError('Choose a workspace folder to scan.')
        path += '?' + urlencode({'path': folder})
    if machine != 'local':
        return remote_request(machine, path, method, body)
    if endpoint == 'state':
        return sanitize(path, {'accounts': accounts(), 'mappings': read_config()['mappings'],
            'config': str(config_path()), 'home': str(Path.home()), 'version': __version__,
            'machine': {'hostname': socket.gethostname()}})
    if endpoint == 'scan':
        return sanitize(path, {'repositories': scan(data['path'])})
    if method == 'DELETE':
        remove_mapping(body['path'], body['host'], body.get('repo'))
        return {'removed': True}
    return add_mapping(body['path'], body['host'], body['account'], body.get('repo'))


try:
    raw = sys.stdin.buffer.read(8193)
    if len(raw) > 8192:
        raise RouterError('GitHub workspace request is too large.')
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError('Expected an object.')
    result = {'ok': True, 'data': handle(data)}
except RouterError as error:
    result = {'ok': False, 'error': str(error), 'status': 400}
except (ValueError, TypeError, KeyError):
    result = {'ok': False, 'error': 'Invalid GitHub workspace request or response.', 'status': 400}
except Exception:
    result = {'ok': False, 'error': 'Could not access GitHub accounts, configuration, or folders.', 'status': 502}
print(json.dumps(result), flush=True)
