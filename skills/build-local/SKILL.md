# Skill: сборка PhaseLab на ПК

Цель: поднять **тот же** измерительный рендер на CPU, затем опционально подключить GPU. Сначала прочитать `map.md` и `README.md`.

1. Python 3.11+, Node 22+, PostgreSQL. Из корня: `python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-runtime.txt`. Для дополнительных научных пакетов `pip install -r requirements.txt`.
2. `npm ci`; создать `.env` с `DATABASE_URL=postgresql://...`, без публикации пароля. `npx drizzle-kit push`. В таблицах должны появиться `lab_state_v2`, `lab_history_v2`, `lab_anchors_v2`, `lab_extensions_v2`, `lab_presets_v2`.
3. Если нет `fixtures/*.wav`: `python tests/generate_synthetic_stems.py`. Если нет `data/reference/report.json`: `OPENBLAS_NUM_THREADS=1 python agent/agent_loop.py --reference --out /tmp/reference.json`.
4. Задать `PYTHON_BIN` абсолютным путём до `.venv/bin/python`, иначе мост запускает системный python и при первом измерении сам создаёт `.pydeps/` через pip. `npm run build && npm run start`. Проверить `/api/health`, `/api/session`, затем `/api/baseline`.
5. Проверить без GPU: `OPENBLAS_NUM_THREADS=1 python -m pytest -q tests/test_pipeline.py`; браузер: Playwright/Chromium, `node tests/browser_smoke.cjs` на отдельной тестовой базе. Требуется отложить ноутбуки/пользовательские файлы, чтобы не тестировать на личной сессии.
6. Для CUDA: установить совместимые torch/torchaudio колёса под свой драйвер и `requirements-accelerated.txt`, затем `python agent/agent_loop.py --device cuda`. Не считать GPU протестированным без результатов тестов и измеренного A/B.

Никогда не обходить `typegen`, `tsc`, build и `/api/health`. После изменения таблиц вызвать `npx drizzle-kit push`. Не редактировать `package.json` вручную — устанавливать пакеты через менеджер.
