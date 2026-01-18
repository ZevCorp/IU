"""
Flash Attention Interface - PyTorch Native Implementation

This provides the same API as flash_attn.flash_attn_interface
"""

from . import (
    flash_attn_func,
    flash_attn_varlen_func,
    flash_attn_qkvpacked_func,
    flash_attn_kvpacked_func,
)

__all__ = [
    'flash_attn_func',
    'flash_attn_varlen_func', 
    'flash_attn_qkvpacked_func',
    'flash_attn_kvpacked_func',
]
