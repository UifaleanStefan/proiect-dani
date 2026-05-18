"""Allow `python -m engine ...`"""
from .cli import main
import sys

sys.exit(main())
