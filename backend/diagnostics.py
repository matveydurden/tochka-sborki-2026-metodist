"""Failure locations without exception messages, source lines, or local values."""
import logging
import traceback
from pathlib import Path


def log_failure(logger,event,error,*,job_id=None,stage=None,status=None,level=logging.ERROR):
    # str(error), exc_info and format_exc can expose keys, prompts or provider bodies.
    frames=' -> '.join(f'{Path(frame.f_code.co_filename).name}:{line}:{frame.f_code.co_name}'
                       for frame,line in traceback.walk_tb(error.__traceback__))
    logger.log(level,'%s exception=%s frames=%s job=%s stage=%s status=%s',
               event,type(error).__name__,frames or '-',job_id or '-',stage or '-',status or '-')
