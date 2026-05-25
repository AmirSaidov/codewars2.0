# Code Zone Backend MVP

Backend for a multiplayer survival coding battle platform.

## Stack

- Python 3.10+
- Django, Django REST Framework
- Django Channels with Redis
- JWT auth via SimpleJWT
- SQLite for MVP
- Docker sandbox for Python submissions

## Local Run

```powershell
.\venv\Scripts\activate
pip install -r requirements.txt
docker compose up -d redis
docker pull python:3.11-alpine
python manage.py migrate
python manage.py runserver
```

API base URL:

```text
http://127.0.0.1:8000/api/
```

WebSocket room URL:

```text
ws://127.0.0.1:8000/ws/rooms/<room_id>/?token=<jwt_access_token>
```

## Environment

The project reads `.env` values with `python-dotenv`.

```env
SECRET_KEY=django-secret-key
DEBUG=True
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
SANDBOX_PYTHON_IMAGE=python:3.11-alpine
```

## Sandbox Notes

Submissions are executed by `apps/submissions/sandbox_runner.py` in a one-shot Docker container with:

- disabled network
- memory limit from task settings
- CPU and PID limits
- read-only container filesystem
- per-test timeout

The backend process must be able to call `docker`.

## Main Endpoints

All endpoints start with `/api/`.

- `POST /api/auth/register/`
- `POST /api/auth/login/`
- `POST /api/auth/refresh/`
- `GET /api/auth/me/`
- `GET|POST /api/rooms/`
- `GET /api/rooms/<id>/`
- `POST /api/rooms/<id>/join/`
- `POST /api/rooms/<id>/leave/`
- `POST /api/rooms/<id>/ready/`
- `POST /api/rooms/<id>/unready/`
- `POST /api/rooms/<id>/start-match/`
- `GET /api/rooms/<id>/leaderboard/`
- `GET|POST /api/tasks/`
- `GET /api/tasks/<id>/`
- `GET /api/matches/`
- `GET /api/matches/<id>/`
- `GET /api/matches/<id>/current-round/`
- `POST /api/matches/<id>/next-round/`
- `POST /api/matches/<id>/pass-player/`
- `POST /api/matches/<id>/eliminate-player/`
- `GET /api/matches/<id>/leaderboard/`
- `GET|POST /api/submissions/`
- `GET /api/submissions/<id>/`
- `POST /api/submissions/<id>/accept/`
- `POST /api/submissions/<id>/reject/`
- `GET /api/leaderboard/rooms/<room_id>/`
- `GET /api/leaderboard/matches/<match_id>/`
