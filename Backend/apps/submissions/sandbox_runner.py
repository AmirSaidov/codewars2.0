import os
import subprocess
import tempfile
import time
from pathlib import Path

from .models import Submission


DOCKER_IMAGE = os.getenv('SANDBOX_PYTHON_IMAGE', 'python:3.11-alpine')
MAX_OUTPUT_LENGTH = 4000


def _truncate(value):
    if value is None:
        return ''
    return value[:MAX_OUTPUT_LENGTH]


def _docker_base_command(workdir, memory_limit):
    return [
        'docker',
        'run',
        '--rm',
        '--network',
        'none',
        '--memory',
        f'{int(memory_limit)}m',
        '--cpus',
        '1',
        '--pids-limit',
        '64',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=16m',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '-v',
        f'{workdir}:/sandbox:ro',
        '-w',
        '/sandbox',
        DOCKER_IMAGE,
    ]


def _run_command(command, stdin, timeout):
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            command,
            input=stdin,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
        elapsed = time.perf_counter() - started
        return {
            'timeout': False,
            'returncode': completed.returncode,
            'stdout': completed.stdout,
            'stderr': completed.stderr,
            'execution_time': elapsed,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            'timeout': True,
            'returncode': None,
            'stdout': exc.stdout or '',
            'stderr': exc.stderr or '',
            'execution_time': time.perf_counter() - started,
        }
    except FileNotFoundError:
        return {
            'timeout': False,
            'returncode': 127,
            'stdout': '',
            'stderr': 'Docker executable was not found.',
            'execution_time': time.perf_counter() - started,
        }


def _normalize_output(value):
    return str(value).replace('\r\n', '\n').strip()


def _public_test_result(test, hidden, status, passed, command_result, expected_output):
    visible_payload = not hidden
    return {
        'name': test.get('name', ''),
        'hidden': hidden,
        'status': status,
        'passed': passed,
        'execution_time': command_result.get('execution_time', 0),
        'input': test.get('input', '') if visible_payload else None,
        'expected_output': expected_output if visible_payload else None,
        'stdout': _truncate(command_result.get('stdout', '')) if visible_payload else '',
        'stderr': _truncate(command_result.get('stderr', '')) if visible_payload else '',
    }


def run_python_code(code, visible_tests, hidden_tests, time_limit, memory_limit):
    tests = [
        {'test': test, 'hidden': False}
        for test in (visible_tests or [])
    ] + [
        {'test': test, 'hidden': True}
        for test in (hidden_tests or [])
    ]

    if not tests:
        return {
            'status': Submission.Status.ACCEPTED,
            'execution_time': 0,
            'test_results': [],
        }

    with tempfile.TemporaryDirectory() as tmpdir:
        source_path = Path(tmpdir) / 'main.py'
        source_path.write_text(code, encoding='utf-8')

        base_command = _docker_base_command(tmpdir, memory_limit)
        compile_command = base_command + [
            'python',
            '-c',
            "import pathlib; compile(pathlib.Path('main.py').read_text(), 'main.py', 'exec')",
        ]
        compile_result = _run_command(compile_command, '', max(float(time_limit), 0.1))
        if compile_result['timeout']:
            return {
                'status': Submission.Status.TIME_LIMIT_EXCEEDED,
                'execution_time': compile_result['execution_time'],
                'test_results': [
                    {
                        'name': 'compile',
                        'hidden': False,
                        'status': Submission.Status.TIME_LIMIT_EXCEEDED,
                        'passed': False,
                        'execution_time': compile_result['execution_time'],
                        'stderr': _truncate(compile_result.get('stderr', '')),
                    }
                ],
            }
        if compile_result['returncode'] != 0:
            status = (
                Submission.Status.RUNTIME_ERROR
                if compile_result['returncode'] == 127
                else Submission.Status.COMPILATION_ERROR
            )
            return {
                'status': status,
                'execution_time': compile_result['execution_time'],
                'test_results': [
                    {
                        'name': 'compile',
                        'hidden': False,
                        'status': status,
                        'passed': False,
                        'execution_time': compile_result['execution_time'],
                        'stdout': _truncate(compile_result.get('stdout', '')),
                        'stderr': _truncate(compile_result.get('stderr', '')),
                    }
                ],
            }

        total_time = 0
        results = []
        overall_status = Submission.Status.ACCEPTED
        run_command = base_command + ['python', 'main.py']

        for item in tests:
            test = item['test']
            hidden = item['hidden']
            test_input = str(test.get('input', ''))
            expected_output = str(test.get('output', test.get('expected_output', test.get('expected', ''))))
            command_result = _run_command(run_command, test_input, max(float(time_limit), 0.1))
            total_time += command_result['execution_time']

            if command_result['timeout']:
                status = Submission.Status.TIME_LIMIT_EXCEEDED
                passed = False
            elif command_result['returncode'] != 0:
                status = Submission.Status.RUNTIME_ERROR
                passed = False
            elif _normalize_output(command_result['stdout']) != _normalize_output(expected_output):
                status = Submission.Status.WRONG_ANSWER
                passed = False
            else:
                status = Submission.Status.ACCEPTED
                passed = True

            if status != Submission.Status.ACCEPTED and overall_status == Submission.Status.ACCEPTED:
                overall_status = status

            results.append(_public_test_result(test, hidden, status, passed, command_result, expected_output))

            if status in [Submission.Status.TIME_LIMIT_EXCEEDED, Submission.Status.RUNTIME_ERROR]:
                break

        return {
            'status': overall_status,
            'execution_time': total_time,
            'test_results': results,
        }
