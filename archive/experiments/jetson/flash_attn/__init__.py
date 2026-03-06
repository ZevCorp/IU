"""
Flash Attention Compatibility Module for Jetson

This package provides a drop-in replacement for flash_attn using 
PyTorch's native scaled_dot_product_attention (available in PyTorch 2.0+).

Simply ensure this 'flash_attn' folder is in your PYTHONPATH before 
imports, and any code that tries to 'from flash_attn import ...' 
will use this native PyTorch implementation.
"""

import torch
import torch.nn.functional as F
from typing import Optional, Tuple

__version__ = "2.8.3-compat"  # Fake version for compatibility checks

def flash_attn_func(
    q: torch.Tensor,
    k: torch.Tensor, 
    v: torch.Tensor,
    dropout_p: float = 0.0,
    softmax_scale: Optional[float] = None,
    causal: bool = False,
    **kwargs
) -> torch.Tensor:
    """
    Fallback implementation of flash_attn_func using PyTorch's scaled_dot_product_attention.
    
    Args:
        q: Query tensor of shape (batch, seqlen_q, num_heads, head_dim)
        k: Key tensor of shape (batch, seqlen_k, num_heads, head_dim)
        v: Value tensor of shape (batch, seqlen_k, num_heads, head_dim)
        dropout_p: Dropout probability
        softmax_scale: Scale for softmax (default: 1/sqrt(head_dim))
        causal: Whether to use causal attention
        
    Returns:
        Output tensor of shape (batch, seqlen_q, num_heads, head_dim)
    """
    # flash_attn uses (batch, seqlen, num_heads, head_dim)
    # PyTorch SDPA uses (batch, num_heads, seqlen, head_dim)
    
    batch_size, seqlen_q, num_heads, head_dim = q.shape
    
    # Transpose to PyTorch format
    q = q.transpose(1, 2)  # (batch, num_heads, seqlen_q, head_dim)
    k = k.transpose(1, 2)  # (batch, num_heads, seqlen_k, head_dim)
    v = v.transpose(1, 2)  # (batch, num_heads, seqlen_k, head_dim)
    
    # Compute scale
    if softmax_scale is None:
        softmax_scale = head_dim ** -0.5
    
    # Use PyTorch's scaled_dot_product_attention (available in PyTorch 2.0+)
    out = F.scaled_dot_product_attention(
        q, k, v,
        attn_mask=None,
        dropout_p=dropout_p if torch.is_grad_enabled() else 0.0,
        is_causal=causal,
        scale=softmax_scale
    )
    
    # Transpose back to flash_attn format
    out = out.transpose(1, 2)  # (batch, seqlen_q, num_heads, head_dim)
    
    return out


def flash_attn_varlen_func(
    q: torch.Tensor,
    k: torch.Tensor,
    v: torch.Tensor,
    cu_seqlens_q: torch.Tensor,
    cu_seqlens_k: torch.Tensor,
    max_seqlen_q: int,
    max_seqlen_k: int,
    dropout_p: float = 0.0,
    softmax_scale: Optional[float] = None,
    causal: bool = False,
    **kwargs
) -> torch.Tensor:
    """
    Variable length attention fallback.
    This is a simplified implementation that doesn't fully support variable lengths.
    """
    # For variable length, we process each sequence separately
    # This is slower but works correctly
    
    batch_size = cu_seqlens_q.shape[0] - 1
    head_dim = q.shape[-1]
    num_heads = q.shape[1] if q.dim() == 3 else q.shape[2]
    
    outputs = []
    
    for i in range(batch_size):
        start_q = cu_seqlens_q[i].item()
        end_q = cu_seqlens_q[i + 1].item()
        start_k = cu_seqlens_k[i].item()
        end_k = cu_seqlens_k[i + 1].item()
        
        q_i = q[start_q:end_q].unsqueeze(0)  # (1, seqlen_q, num_heads, head_dim) or adjust
        k_i = k[start_k:end_k].unsqueeze(0)
        v_i = v[start_k:end_k].unsqueeze(0)
        
        out_i = flash_attn_func(q_i, k_i, v_i, dropout_p, softmax_scale, causal)
        outputs.append(out_i.squeeze(0))
    
    return torch.cat(outputs, dim=0)


def flash_attn_qkvpacked_func(
    qkv: torch.Tensor,
    dropout_p: float = 0.0,
    softmax_scale: Optional[float] = None,
    causal: bool = False,
    **kwargs
) -> torch.Tensor:
    """
    Packed QKV attention fallback.
    qkv shape: (batch, seqlen, 3, num_heads, head_dim)
    """
    q, k, v = qkv.unbind(dim=2)
    return flash_attn_func(q, k, v, dropout_p, softmax_scale, causal, **kwargs)


def flash_attn_kvpacked_func(
    q: torch.Tensor,
    kv: torch.Tensor,
    dropout_p: float = 0.0,
    softmax_scale: Optional[float] = None,
    causal: bool = False,
    **kwargs
) -> torch.Tensor:
    """
    Packed KV attention fallback.
    kv shape: (batch, seqlen, 2, num_heads, head_dim)
    """
    k, v = kv.unbind(dim=2)
    return flash_attn_func(q, k, v, dropout_p, softmax_scale, causal, **kwargs)


# For imports like "from flash_attn.flash_attn_interface import flash_attn_func"
# We also need the submodule
class FlashAttnInterface:
    flash_attn_func = staticmethod(flash_attn_func)
    flash_attn_varlen_func = staticmethod(flash_attn_varlen_func)
    flash_attn_qkvpacked_func = staticmethod(flash_attn_qkvpacked_func)
    flash_attn_kvpacked_func = staticmethod(flash_attn_kvpacked_func)


# Make this accessible as a submodule
import sys
flash_attn_interface = FlashAttnInterface()
