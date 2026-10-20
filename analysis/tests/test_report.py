"""report 指令的冒煙測試：對 fixtures 資料夾跑一次，檢查輸出檔案。"""

from pathlib import Path

from sunsunbus.cli import main

FIXTURES = Path(__file__).parent / "fixtures"


def test_report_runs(tmp_path):
    assert main(["report", str(FIXTURES), "--out", str(tmp_path)]) == 0
    for f in ("trips.csv", "events.csv", "rates_by_route_hour.csv", "distribution_by_placement.png", "events_map.html", "report.md"):
        assert (tmp_path / f).exists(), f
    assert len(list((tmp_path / "plots").glob("*.png"))) == 5
